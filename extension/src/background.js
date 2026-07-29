import { installSniffer, captureConfig, getCapturedConfig } from "./sniff.js";
import { transformItem } from "./transform.js";
import { fetchTimeline } from "./xapi.js";

const SERVER_URL = "http://127.0.0.1:4177";
const BATCH_SIZE = 50;
const EARLY_EXIT_THRESHOLD = 100;

installSniffer();
installHeaderRule();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sync") return;
  const send = makeSafeSender(port);
  port.onMessage.addListener(async (message) => {
    if (message.type !== "start") return;
    try {
      await runSync(message.sources || ["bookmark", "heart"], send);
    } catch (error) {
      send({ type: "error", text: String(error?.message || error) });
    }
  });
});

let syncInProgress = false;

async function runSync(sources, send) {
  if (syncInProgress) throw new Error("A sync is already in progress.");
  syncInProgress = true;
  try {
    if (!(await pingServer())) {
      throw new Error("Momento is offline. Run `momento serve` in a terminal first.");
    }
    if (!(await hasXSession())) {
      throw new Error("No X session found. Sign in at x.com and retry.");
    }

    const totals = { seen: 0, inserted: 0, updated: 0 };
    for (const source of sources) {
      const result = await syncSource(source, send);
      totals.seen += result.seen;
      totals.inserted += result.inserted;
      totals.updated += result.updated;
    }
    send({ type: "done", ...totals, sources });
  } finally {
    syncInProgress = false;
  }
}

async function syncSource(source, send) {
  const label = source === "heart" ? "Hearts" : "Bookmarks";
  send({ type: "progress", source, text: `Preparing ${label}…` });
  let config = await getCapturedConfig(source);
  if (!config) config = await captureConfig(source);

  const knownIds = await fetchKnownIds(source);
  const firstSync = knownIds.size === 0;
  let consecutiveKnown = 0;
  let batch = [];
  const totals = { seen: 0, inserted: 0, updated: 0 };
  const syncStartedAt = Date.now();
  let sourcePosition = 0;
  const onLog = (text) => send({ type: "progress", source, text });

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await upload(batch, onLog);
    totals.seen += result.seen ?? batch.length;
    totals.inserted += result.inserted ?? 0;
    totals.updated += result.updated ?? 0;
    send({
      type: "progress",
      source,
      text: `${label}: ${totals.seen} checked · ${totals.inserted} new`,
    });
    batch = [];
  };

  for await (const raw of fetchTimeline(config, source, { onLog })) {
    // X timelines arrive newest-save first. Preserve that ordering even though
    // X does not expose an exact bookmarked/liked timestamp.
    const savedAt = new Date(syncStartedAt - sourcePosition).toISOString();
    sourcePosition += 1;
    const item = transformItem(raw, source, { savedAt });
    if (!item) continue;
    batch.push(item);

    if (!firstSync) {
      consecutiveKnown = knownIds.has(item.id) ? consecutiveKnown + 1 : 0;
    }
    if (batch.length >= BATCH_SIZE) await flush();
    if (!firstSync && consecutiveKnown >= EARLY_EXIT_THRESHOLD) {
      onLog(`${label}: caught up after ${EARLY_EXIT_THRESHOLD} known items.`);
      break;
    }
  }
  await flush();
  return totals;
}

async function pingServer() {
  try {
    return (await fetch(`${SERVER_URL}/api/health`)).ok;
  } catch {
    return false;
  }
}

async function fetchKnownIds(source) {
  try {
    const response = await fetch(`${SERVER_URL}/api/known-ids?source=${source}`);
    if (!response.ok) return new Set();
    return new Set((await response.json()).ids || []);
  } catch {
    return new Set();
  }
}

async function upload(items, onLog) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_URL}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) throw new Error(`Archive returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 5) break;
      onLog?.(`Could not write batch. Retry ${attempt}/5…`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error("Could not write to Momento.");
}

async function hasXSession() {
  const [auth, csrf] = await Promise.all([
    chrome.cookies.get({ url: "https://x.com", name: "auth_token" }),
    chrome.cookies.get({ url: "https://x.com", name: "ct0" }),
  ]);
  return Boolean(auth && csrf);
}

function makeSafeSender(port) {
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
  });
  return (message) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      connected = false;
    }
  };
}

function installHeaderRule() {
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://x.com" },
              { header: "Referer", operation: "set", value: "https://x.com/" },
            ],
          },
          condition: {
            urlFilter: "https://x.com/i/api/graphql/*",
            resourceTypes: ["xmlhttprequest"],
            initiatorDomains: [chrome.runtime.id],
          },
        },
      ],
    })
    .catch((error) => console.error("Could not install header rule", error));
}
