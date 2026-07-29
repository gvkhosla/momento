// Capture X's live GraphQL config so rotating query IDs do not break Momento.

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
  const twid = await chrome.cookies.get({ url: "https://x.com", name: "twid" });
  const userId = decodeURIComponent(twid?.value || "").match(/u=(\d+)/)?.[1];
  if (!userId) return null;

  const tab = await chrome.tabs.create({ url: "https://x.com/home", active: false });
  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await sleep(500);
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "momento-detect-profile" });
        if (response?.screenName) return { userId, screenName: response.screenName };
      } catch {
        // The X page or content script is still loading.
      }
    }
    return null;
  } finally {
    if (tab.id != null) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
