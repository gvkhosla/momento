// X GraphQL timeline crawl for Likes and Bookmarks.
// Rate-limit strategy adapted from bookmarx/xarchive.

const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const PAGE_SIZE = 100;
const BASE_DELAY_MS = 2500;
const MAX_RETRIES = 5;
const MAX_CONSECUTIVE_EMPTY = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitteredDelay = () => BASE_DELAY_MS * (0.7 + Math.random() * 0.8);

export async function* fetchTimeline(config, source, { onLog } = {}) {
  const state = { consecutiveRateLimits: 0 };
  let cursor = null;
  let page = 0;
  let consecutiveEmpty = 0;

  while (true) {
    const variables = buildVariables(source, config.userId, cursor);
    const response = await fetchWithRetry({ config, variables, state, onLog });
    if (!response.ok) throw new Error(`Aborted: ${response.reason}`);
    state.consecutiveRateLimits = 0;

    const { entries, nextCursor } = extractTimeline(response.data, source);
    page += 1;
    const label = source === "heart" ? "hearts" : "bookmarks";

    if (entries.length === 0) {
      consecutiveEmpty += 1;
      onLog?.(`Page ${page}: no ${label} (${consecutiveEmpty}/${MAX_CONSECUTIVE_EMPTY})`);
    } else {
      consecutiveEmpty = 0;
      onLog?.(`Page ${page}: ${entries.length} ${label}`);
      for (const entry of entries) yield entry;
    }

    if (!nextCursor || nextCursor === cursor) return;
    if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
      onLog?.("Stopped after repeated empty pages. X may be throttling this sync.");
      return;
    }

    cursor = nextCursor;
    await sleep(jitteredDelay());
  }
}

function buildVariables(source, userId, cursor) {
  const common = {
    count: PAGE_SIZE,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {}),
  };
  if (source === "heart") {
    return {
      ...common,
      userId: String(userId),
      withClientEventToken: false,
      withVoice: false,
    };
  }
  return common;
}

async function fetchWithRetry({ config, variables, state, onLog }) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    const response = await graphqlRequest(config, variables);
    if (!response.error) return { ok: true, data: response.data };

    if (response.error === "auth_error") {
      return { ok: false, reason: "Sign in to x.com and try again." };
    }

    retries += 1;
    if (response.error === "rate_limited") {
      state.consecutiveRateLimits += 1;
      if (state.consecutiveRateLimits >= 5) {
        return { ok: false, reason: "X rate-limited five requests in a row. Try again later." };
      }
      if (state.consecutiveRateLimits >= 3) {
        onLog?.("X is rate-limiting. Cooling down for five minutes…");
        await sleep(5 * 60 * 1000);
        continue;
      }
    }

    const delay = BASE_DELAY_MS * 2 ** retries + Math.random() * 1000;
    onLog?.(`X request failed. Retrying in ${(delay / 1000).toFixed(1)}s…`);
    await sleep(delay);
  }
  return { ok: false, reason: "X did not respond after repeated retries." };
}

async function graphqlRequest(config, variables) {
  const csrf = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
  if (!csrf?.value) return { error: "auth_error" };

  const url = new URL(
    `https://x.com/i/api/graphql/${config.queryId}/${config.operation}`,
  );
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("features", config.features);

  try {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER_TOKEN}`,
        "content-type": "application/json",
        "x-csrf-token": csrf.value,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
      },
    });

    if (response.status === 401 || response.status === 403) return { error: "auth_error" };
    if (response.status === 429) return { error: "rate_limited" };
    if (!response.ok) return { error: "http_error", status: response.status };

    const data = await response.json();
    if (data?.errors?.some((error) => error.code === 88)) return { error: "rate_limited" };
    if (data?.errors) return { error: "graphql_error" };
    return { data };
  } catch (error) {
    return { error: "network_error", message: String(error?.message || error) };
  }
}

function extractTimeline(json, source) {
  const instructions =
    source === "bookmark"
      ? json?.data?.bookmark_timeline_v2?.timeline?.instructions ??
        json?.data?.bookmark_timeline?.timeline?.instructions ??
        []
      : json?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
        json?.data?.user?.result?.timeline?.timeline?.instructions ??
        json?.data?.user_result?.result?.timeline?.timeline?.instructions ??
        [];

  const tweets = [];
  const seen = new Set();
  let nextCursor = null;

  for (const instruction of instructions) {
    const entries = instruction.entries || (instruction.entry ? [instruction.entry] : []);
    for (const entry of entries) {
      const content = entry.content;
      const result =
        content?.itemContent?.tweet_results?.result ??
        content?.itemContent?.tweet_results;
      if (result) addTweet(result, tweets, seen);

      for (const moduleItem of content?.items || []) {
        const moduleResult =
          moduleItem?.item?.itemContent?.tweet_results?.result ??
          moduleItem?.item?.itemContent?.tweet_results;
        if (moduleResult) addTweet(moduleResult, tweets, seen);
      }

      if (content?.entryType === "TimelineTimelineCursor" && content.cursorType === "Bottom") {
        nextCursor = content.value;
      }
      if (entry.entryId?.startsWith("cursor-bottom") && content?.value) {
        nextCursor = content.value;
      }
    }
  }
  return { entries: tweets, nextCursor };
}

function addTweet(result, tweets, seen) {
  const id = result?.rest_id || result?.tweet?.rest_id || JSON.stringify(result).slice(0, 80);
  if (seen.has(id)) return;
  seen.add(id);
  tweets.push(result);
}
