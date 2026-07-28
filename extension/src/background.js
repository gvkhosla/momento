import { fetchAllLikes } from "./xapi.js";
import { transformLike } from "./transform.js";
import { installSniffer, captureNow, getCapturedConfig } from "./sniff.js";

const SERVER_URL = "http://127.0.0.1:4177";
const BATCH_SIZE = 50;
const EARLY_EXIT_THRESHOLD = 100;

installSniffer();

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
  .catch((err) => console.error("DNR rule registration failed:", err));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sync") return;
  const send = makeSafeSender(port);
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "start") return;
    try {
      await runSync(send);
    } catch (err) {
      send({ type: "error", text: String(err?.message ?? err) });
    }
  });
});

function makeSafeSender(port) {
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
  });
  return (msg) => {
    if (!connected) return;
    try {
      port.postMessage(msg);
    } catch {
      connected = false;
    }
  };
}

let syncInProgress = false;

async function runSync(send) {
  if (syncInProgress) {
    send({ type: "error", text: "A sync is already in progress." });
    return;
  }
  syncInProgress = true;
  try {
    await runSyncInner(send);
  } finally {
    syncInProgress = false;
  }
}

async function runSyncInner(send) {
  const healthy = await pingServer();
  if (!healthy) {
    throw new Error(
      "momento server not reachable at http://127.0.0.1:4177 — run: momento serve",
    );
  }

  const hasSession = await hasXSession();
  if (!hasSession) {
    throw new Error("No x.com session. Sign in to X in another tab.");
  }

  send({ type: "progress", text: "Capturing X Likes API config..." });
  let config = await getCapturedConfig();
  if (!config) config = await captureNow();

  send({ type: "progress", text: "Checking known likes..." });
  const knownIds = await fetchKnownIds();
  const isFirstSync = knownIds.size === 0;

  let totalSeen = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let consecutiveKnown = 0;
  let batch = [];

  const onLog = (text) => send({ type: "progress", text });

  const flush = async () => {
    if (batch.length === 0) return;
    const r = await upload(batch, onLog);
    totalSeen += r.seen ?? batch.length;
    totalInserted += r.inserted ?? 0;
    totalUpdated += r.updated ?? 0;
    send({
      type: "progress",
      text: `Synced ${totalSeen} (${totalInserted} new, vault ${r.total ?? "?"})...`,
    });
    batch = [];
  };

  for await (const raw of fetchAllLikes(config, { onLog })) {
    const transformed = transformLike(raw);
    if (!transformed) continue;

    batch.push(transformed);

    if (!isFirstSync) {
      if (knownIds.has(transformed.id)) consecutiveKnown += 1;
      else consecutiveKnown = 0;
    }

    if (batch.length >= BATCH_SIZE) await flush();

    if (!isFirstSync && consecutiveKnown >= EARLY_EXIT_THRESHOLD) {
      onLog(`Early exit: ${EARLY_EXIT_THRESHOLD} known likes in a row.`);
      break;
    }
  }

  await flush();

  send({
    type: "done",
    seen: totalSeen,
    inserted: totalInserted,
    updated: totalUpdated,
  });
}

async function pingServer() {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchKnownIds() {
  try {
    const res = await fetch(`${SERVER_URL}/known-ids`);
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.ids ?? []);
  } catch {
    return new Set();
  }
}

async function upload(likes, onLog) {
  const MAX_ATTEMPTS = 5;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${SERVER_URL}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ likes }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ingest ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = 1000 * Math.pow(2, attempt - 1);
      onLog?.(
        `Upload failed (${attempt}/${MAX_ATTEMPTS}): ${err?.message ?? err}. Retrying...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error("Upload failed");
}

async function hasXSession() {
  const [auth, ct0] = await Promise.all([
    chrome.cookies.get({ url: "https://x.com", name: "auth_token" }),
    chrome.cookies.get({ url: "https://x.com", name: "ct0" }),
  ]);
  return Boolean(auth && ct0);
}
