import { existsSync } from "node:fs";
import { basename } from "node:path";
import { downloadImage, extractUrl, imageDest, pickExtractUrl } from "./extract.js";
import { refreshIndex } from "./index-vault.js";
import { ingestItems, loadItems } from "./store.js";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_LIMIT = 40;

export function enrichmentStatus(item) {
  return item?.extraction?.status || "pending";
}

export function needsEnrichment(item) {
  if (!item?.sources?.includes("bookmark")) return false;
  const status = enrichmentStatus(item);
  if (status === "ready" || status === "skipped" || status === "none") return false;
  return Boolean(pickExtractUrl(item));
}

export async function enrichRecords(home, items, options = {}) {
  if (!items.length) return [];
  const incoming = [];
  const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    incoming.push(...(await Promise.all(batch.map((item) => enrichItem(home, item, options)))));
  }
  ingestItems(home, incoming, { removeDemo: false });
  if (options.index !== false && incoming.some((item) => item.extraction?.status === "ready")) {
    try {
      await refreshIndex(home, { reason: "enrich" });
    } catch (error) {
      console.error(`Momento index refresh skipped: ${error?.message || error}`);
    }
  }
  return incoming;
}

export async function enrichVault(home, options = {}) {
  const items = loadItems(home);
  const pending = items.filter(needsEnrichment);
  const limit = Math.max(1, Number(options.limit || DEFAULT_LIMIT));
  const queue = pending.slice(0, limit);
  const results = { seen: pending.length, attempted: queue.length, ready: 0, failed: 0, skipped: 0, unchanged: 0 };
  if (queue.length === 0) return { ...results, indexed: false, total: items.length };
  const incoming = await enrichRecords(home, queue, options);
  for (const record of incoming) {
    const status = record.extraction?.status;
    if (status === "ready") results.ready += 1;
    else if (status === "failed") results.failed += 1;
    else results.skipped += 1;
  }
  return { ...results, indexed: results.ready > 0 && options.index !== false, total: loadItems(home).length };
}

async function enrichItem(home, item, options) {
  const url = pickExtractUrl(item);
  if (!url) {
    return withExtraction(item, { status: "none", reason: "no_external_url" });
  }
  try {
    const extracted = await extractUrl(url, {
      fetchImpl: options.fetchImpl,
      timeout: options.timeout || 12_000,
    });
    if (extracted.status !== "ready") {
      return withExtraction(item, extracted);
    }
    let localImage = item.extraction?.localImage || "";
    if (extracted.imageUrl && !localImage) {
      try {
        const dest = await downloadImage(extracted.imageUrl, imageDest(home, item.id), {
          fetchImpl: options.fetchImpl,
        });
        if (dest) localImage = basename(dest);
      } catch {
        localImage = "";
      }
    }
    return withExtraction(item, {
      ...extracted,
      localImage,
      extractedAt: new Date().toISOString(),
    });
  } catch (error) {
    return withExtraction(item, {
      status: "failed",
      url,
      error: String(error?.message || error),
    });
  }
}

function withExtraction(item, extraction) {
  return {
    ...item,
    extraction: {
      ...(item.extraction || {}),
      ...extraction,
    },
  };
}

export function bookmarkCorpus(home) {
  return loadItems(home).filter((item) => item.sources?.includes("bookmark"));
}

export function recentBookmarks(home, { since, limit = 40 } = {}) {
  const cutoff = since ? new Date(since).getTime() : 0;
  return bookmarkCorpus(home)
    .filter((item) => {
      const stamp = new Date(item.bookmarkedAt || item.savedAt || 0).getTime();
      return Number.isFinite(stamp) && stamp >= cutoff;
    })
    .sort((a, b) => new Date(b.bookmarkedAt || b.savedAt) - new Date(a.bookmarkedAt || a.savedAt))
    .slice(0, limit);
}

export function localImagePath(home, item) {
  const name = item?.extraction?.localImage;
  if (!name) return "";
  const path = joinSafe(home, name);
  return existsSync(path) ? path : "";
}

function joinSafe(home, name) {
  return `${home}/media/${String(name).replace(/[^a-zA-Z0-9._-]/g, "")}`;
}
