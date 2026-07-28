// Sniff X's live Likes GraphQL request so we self-heal when query IDs rotate.

const URL_PATTERN = /\/i\/api\/graphql\/([^/]+)\/Likes(?:\b|\/|\?)/;
const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export function installSniffer() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const m = details.url.match(URL_PATTERN);
      if (!m) return;
      try {
        const u = new URL(details.url);
        const features = u.searchParams.get("features");
        const variables = u.searchParams.get("variables");
        if (!features) return;
        const patch = {
          likesQueryId: m[1],
          likesFeatures: features,
          likesCapturedAt: Date.now(),
        };
        if (variables) {
          try {
            const v = JSON.parse(variables);
            if (v.userId) patch.likesUserId = String(v.userId);
          } catch {
            // ignore
          }
        }
        chrome.storage.local.set(patch);
      } catch {
        // ignore
      }
    },
    { urls: ["https://x.com/i/api/graphql/*/Likes*"] },
  );
}

export async function getCapturedConfig() {
  const data = await chrome.storage.local.get([
    "likesQueryId",
    "likesFeatures",
    "likesUserId",
  ]);
  if (!data.likesQueryId || !data.likesFeatures || !data.likesUserId) {
    return null;
  }
  return {
    queryId: data.likesQueryId,
    features: data.likesFeatures,
    userId: data.likesUserId,
  };
}

export async function captureNow({ timeoutMs = 25000 } = {}) {
  const existing = await getCapturedConfig();
  if (existing) return existing;

  const viewer = await fetchViewer();
  if (!viewer?.userId || !viewer?.screenName) {
    throw new Error(
      "Couldn't detect your X account. Sign in at x.com, open your profile Likes once, then Sync again.",
    );
  }

  await chrome.storage.local.set({ likesUserId: String(viewer.userId) });

  const before = Date.now();
  const tab = await chrome.tabs.create({
    url: `https://x.com/${viewer.screenName}/likes`,
    active: false,
  });

  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(400);
      const cfg = await getCapturedConfig();
      if (cfg?.queryId && cfg?.features) return cfg;

      const { likesCapturedAt } = await chrome.storage.local.get([
        "likesCapturedAt",
      ]);
      if (likesCapturedAt && likesCapturedAt >= before) {
        const again = await getCapturedConfig();
        if (again) return again;
      }
    }
    throw new Error(
      "Couldn't capture X Likes API config. Open x.com/YOUR_HANDLE/likes in a tab, wait for likes to load, then Sync again.",
    );
  } finally {
    if (tab.id != null) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // ignore
      }
    }
  }
}

async function fetchViewer() {
  try {
    const ct0 = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
    if (!ct0?.value) return null;
    const res = await fetch(
      "https://api.x.com/1.1/account/verify_credentials.json",
      {
        credentials: "include",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "x-csrf-token": ct0.value,
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.id_str) return null;
    return { userId: data.id_str, screenName: data.screen_name };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
