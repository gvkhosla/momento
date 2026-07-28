// X Likes GraphQL crawl. Rate-limit strategy adapted from bookmarx/xarchive.

const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const OP = "Likes";
const PAGE_SIZE = 100;
const BASE_DELAY_MS = 2500;
const JITTER_MIN = 0.7;
const JITTER_MAX = 1.5;
const MAX_RETRIES = 5;
const COOLDOWN_MS = 5 * 60 * 1000;
const CONSECUTIVE_429_COOLDOWN = 3;
const CONSECUTIVE_429_STOP = 5;
const MAX_CONSECUTIVE_EMPTY = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitteredDelay = () =>
  BASE_DELAY_MS * (JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN));

async function getFreshCt0() {
  const c = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
  return c?.value ?? null;
}

async function graphqlRequest({ queryId, features, variables }) {
  const csrfToken = await getFreshCt0();
  if (!csrfToken) return { error: "auth_error", status: 0 };

  const url = new URL(`https://x.com/i/api/graphql/${queryId}/${OP}`);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("features", features);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER_TOKEN}`,
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
      },
    });
  } catch (err) {
    return { error: "network_error", message: String(err?.message ?? err) };
  }

  if (res.status === 429) return { error: "rate_limited", status: 429 };
  if (res.status === 401 || res.status === 403) {
    return { error: "auth_error", status: res.status };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      error: "http_error",
      status: res.status,
      message: text.slice(0, 200),
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { error: "network_error", message: String(err?.message ?? err) };
  }
  if (data?.errors?.some((e) => e.code === 88)) {
    return { error: "rate_limited", status: 200 };
  }
  if (data?.errors) {
    return { error: "graphql_error", errors: data.errors };
  }
  return { data };
}

async function fetchWithRetry({ queryId, features, variables, state, onLog }) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    const r = await graphqlRequest({ queryId, features, variables });
    if (!r.error) return { ok: true, data: r.data };

    if (r.error === "rate_limited") {
      state.consecutive429s += 1;
      retries += 1;
      if (state.consecutive429s >= CONSECUTIVE_429_STOP) {
        onLog?.(`Stopped: ${CONSECUTIVE_429_STOP} rate-limits in a row.`);
        return { ok: false, reason: "rate_limit_exceeded" };
      }
      if (state.consecutive429s >= CONSECUTIVE_429_COOLDOWN) {
        onLog?.(
          `Cooling down 5 min after ${state.consecutive429s} rate-limits...`,
        );
        await sleep(COOLDOWN_MS);
        continue;
      }
      const backoff =
        BASE_DELAY_MS * Math.pow(2, retries) + Math.random() * 1000;
      onLog?.(
        `Rate limited (${retries}/${MAX_RETRIES}). Waiting ${(backoff / 1000).toFixed(1)}s...`,
      );
      await sleep(backoff);
      continue;
    }

    if (r.error === "auth_error") {
      onLog?.(`Auth error (${r.status}). Sign in to x.com.`);
      return { ok: false, reason: "auth_error" };
    }

    retries += 1;
    const backoff = BASE_DELAY_MS * Math.pow(2, retries);
    onLog?.(
      `Transient error: ${r.error} (${r.status ?? ""}). Retry ${retries}/${MAX_RETRIES}...`,
    );
    await sleep(backoff);
  }
  return { ok: false, reason: "max_retries" };
}

export async function* fetchAllLikes(config, { onLog } = {}) {
  const { queryId, features, userId } = config;
  const state = { consecutive429s: 0 };
  let cursor = null;
  let pageNum = 0;
  let consecutiveEmpty = 0;

  while (true) {
    const variables = {
      userId: String(userId),
      count: PAGE_SIZE,
      includePromotedContent: false,
      withClientEventToken: false,
      withVoice: false,
      ...(cursor ? { cursor } : {}),
    };

    const r = await fetchWithRetry({
      queryId,
      features,
      variables,
      state,
      onLog,
    });
    if (!r.ok) throw new Error(`Aborted: ${r.reason}`);
    state.consecutive429s = 0;

    const { entries, nextCursor } = extractEntries(r.data);
    pageNum += 1;

    if (entries.length === 0) {
      consecutiveEmpty += 1;
      onLog?.(
        `Page ${pageNum}: empty (${consecutiveEmpty}/${MAX_CONSECUTIVE_EMPTY})`,
      );
    } else {
      consecutiveEmpty = 0;
      onLog?.(`Page ${pageNum}: ${entries.length} likes`);
      for (const e of entries) yield e;
    }

    if (!nextCursor) {
      onLog?.("Done: no next cursor.");
      return;
    }
    if (nextCursor === cursor) {
      onLog?.("Done: pagination loop detected.");
      return;
    }
    if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
      onLog?.(
        `Stopping: ${MAX_CONSECUTIVE_EMPTY} empty pages (likely throttled).`,
      );
      return;
    }

    cursor = nextCursor;
    await sleep(jitteredDelay());
  }
}

function extractEntries(json) {
  const instructions =
    json?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
    json?.data?.user?.result?.timeline?.timeline?.instructions ??
    json?.data?.user_result?.result?.timeline?.timeline?.instructions ??
    [];

  const tweets = [];
  let nextCursor = null;

  for (const inst of instructions) {
    const entries =
      inst.type === "TimelineAddEntries"
        ? inst.entries ?? []
        : inst.type === "TimelinePinEntry" && inst.entry
          ? [inst.entry]
          : [];

    for (const entry of entries) {
      const content = entry.content;
      if (content?.entryType === "TimelineTimelineItem") {
        const result =
          content.itemContent?.tweet_results?.result ??
          content.itemContent?.tweet_results;
        if (result) tweets.push(result);
      } else if (content?.entryType === "TimelineTimelineCursor") {
        if (content.cursorType === "Bottom") nextCursor = content.value;
      }
      // cursors sometimes live at entryId level
      if (
        entry.entryId?.startsWith("cursor-bottom") &&
        content?.value
      ) {
        nextCursor = content.value;
      }
    }
  }
  return { entries: tweets, nextCursor };
}
