// Capture X's live GraphQL config so rotating query IDs do not break Momento.

const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const PATTERN = /\/i\/api\/graphql\/([^/]+)\/(Likes|Bookmarks)(?:\b|\/|\?)/;

export function installSniffer() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const match = details.url.match(PATTERN);
      if (!match) return;
      try {
        const url = new URL(details.url);
        const features = url.searchParams.get("features");
        const variables = url.searchParams.get("variables");
        if (!features) return;
        const source = match[2] === "Likes" ? "heart" : "bookmark";
        const patch = {
          [`${source}QueryId`]: match[1],
          [`${source}Features`]: features,
          [`${source}CapturedAt`]: Date.now(),
        };
        if (variables) {
          try {
            const parsed = JSON.parse(variables);
            if (parsed.userId) patch.heartUserId = String(parsed.userId);
          } catch {
            // Ignore malformed variables.
          }
        }
        chrome.storage.local.set(patch);
      } catch {
        // Ignore malformed URLs.
      }
    },
    {
      urls: [
        "https://x.com/i/api/graphql/*/Likes*",
        "https://x.com/i/api/graphql/*/Bookmarks*",
      ],
    },
  );
}

export async function getCapturedConfig(source) {
  const prefix = source === "heart" ? "heart" : "bookmark";
  const keys = [`${prefix}QueryId`, `${prefix}Features`, "heartUserId"];
  const data = await chrome.storage.local.get(keys);
  const queryId = data[`${prefix}QueryId`];
  const features = data[`${prefix}Features`];
  if (!queryId || !features || (source === "heart" && !data.heartUserId)) return null;
  return {
    queryId,
    features,
    operation: source === "heart" ? "Likes" : "Bookmarks",
    ...(source === "heart" ? { userId: data.heartUserId } : {}),
  };
}

export async function captureConfig(source, { timeoutMs = 25000 } = {}) {
  const existing = await getCapturedConfig(source);
  if (existing) return existing;

  let target = "https://x.com/i/bookmarks";
  if (source === "heart") {
    const viewer = await fetchViewer();
    if (!viewer) {
      throw new Error("Could not detect your X account. Open your profile Hearts tab once, then retry.");
    }
    await chrome.storage.local.set({ heartUserId: String(viewer.userId) });
    target = `https://x.com/${viewer.screenName}/likes`;
  }

  const tab = await chrome.tabs.create({ url: target, active: false });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(400);
      const config = await getCapturedConfig(source);
      if (config) return config;
    }
    const label = source === "heart" ? "Hearts" : "Bookmarks";
    throw new Error(`Could not capture X ${label}. Open that page in X, let it load, then retry.`);
  } finally {
    if (tab.id != null) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fetchViewer() {
  try {
    const csrf = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
    if (!csrf?.value) return null;
    const response = await fetch("https://api.x.com/1.1/account/verify_credentials.json", {
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER}`,
        "x-csrf-token": csrf.value,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.id_str ? { userId: data.id_str, screenName: data.screen_name } : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
