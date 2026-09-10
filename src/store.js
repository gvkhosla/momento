import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { slugName, toMarkdown } from "./format.js";

const STORE_FILE = "items.json";
const SOURCE_NAMES = new Set(["heart", "bookmark", "shared"]);
const storeCache = new Map();

export function ensureVault(home) {
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "by-id"), { recursive: true });
}

export function loadItems(home) {
  ensureVault(home);
  const path = join(home, STORE_FILE);
  if (!existsSync(path)) return [];

  try {
    const stat = statSync(path);
    const cached = storeCache.get(path);
    if (cached?.mtimeMs === stat.mtimeMs && cached?.size === stat.size) {
      return cached.items;
    }
    const data = JSON.parse(readFileSync(path, "utf8"));
    const items = Array.isArray(data) ? data.map(normalizeRecord).filter(Boolean) : [];
    storeCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, items });
    return items;
  } catch {
    return [];
  }
}

export function ingestItems(home, incoming, { removeDemo = true } = {}) {
  ensureVault(home);
  const now = new Date().toISOString();
  const validIncoming = incoming
    .map((item) => normalizeRecord(item, now))
    .filter(Boolean);
  const hasRealItems = validIncoming.some((item) => !item.demo);

  let existing = loadItems(home);
  const demosToRemove = [];
  if (removeDemo && hasRealItems) {
    for (const item of existing) {
      if (item.demo) demosToRemove.push(item);
    }
    existing = existing.filter((item) => !item.demo);
  }

  const byId = new Map(existing.map((item) => [String(item.id), item]));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const skipped = incoming.length - validIncoming.length;
  const changed = [];

  for (const next of validIncoming) {
    const previous = byId.get(next.id);
    const merged = previous ? mergeRecords(previous, next, now) : next;
    if (previous && sameRecord(previous, merged)) {
      unchanged += 1;
      continue;
    }
    byId.set(next.id, merged);
    changed.push({ previous, current: merged });
    if (previous) updated += 1;
    else inserted += 1;
  }

  const hasChanges = changed.length > 0 || demosToRemove.length > 0;
  const items = hasChanges
    ? [...byId.values()].sort(sortNewestFirst)
    : existing;

  if (hasChanges) {
    writeStore(home, items);
    for (const demo of demosToRemove) removeMarkdown(home, demo);
    for (const { previous, current } of changed) {
      if (previous) removeStaleMarkdown(home, previous, current);
      writeMarkdown(home, current);
    }
    writeVaultReadme(home, items);
  }

  return {
    seen: incoming.length,
    inserted,
    updated,
    unchanged,
    skipped,
    total: items.length,
    counts: countSources(items),
  };
}

export function getKnownIds(home, source) {
  const wanted = normalizeSource(source);
  return loadItems(home)
    .filter((item) => !wanted || item.sources.includes(wanted))
    .map((item) => item.id);
}

export function countSources(items) {
  const counts = { all: items.length, heart: 0, bookmark: 0, shared: 0 };
  for (const item of items) {
    for (const source of item.sources) {
      if (source in counts) counts[source] += 1;
    }
  }
  return counts;
}

export function clearDemo(home) {
  const items = loadItems(home);
  const demos = items.filter((item) => item.demo);
  if (demos.length === 0) return 0;
  for (const item of demos) removeMarkdown(home, item);
  const kept = items.filter((item) => !item.demo);
  writeStore(home, kept);
  writeVaultReadme(home, kept);
  return demos.length;
}

/**
 * Repair archives imported before v0.3, when later crawl pages accidentally
 * received newer save timestamps. This is intentionally explicit and creates
 * a backup because it should only be run once on an affected source.
 */
export function repairLegacySourceOrder(home, source) {
  const wanted = normalizeSource(source);
  if (!wanted) throw new Error("Choose bookmark, heart, or shared.");

  const items = loadItems(home);
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.sources.includes(wanted));
  if (candidates.length === 0) {
    return { repaired: 0, backup: null };
  }

  const storePath = join(home, STORE_FILE);
  const backup = join(home, `items.before-${wanted}-order-repair.${Date.now()}.json`);
  copyFileSync(storePath, backup);

  const sourceKey = sourceDateKey(wanted);
  candidates.sort((a, b) => {
    const aDate = new Date(a.item[sourceKey] || a.item.savedAt || 0).getTime();
    const bDate = new Date(b.item[sourceKey] || b.item.savedAt || 0).getTime();
    return aDate - bDate || a.index - b.index;
  });

  const base = Date.now();
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index].item;
    item[sourceKey] = new Date(base - index).toISOString();
    item.savedAt = latestSourceDate(item) || item.savedAt;
  }

  items.sort(sortNewestFirst);
  writeStore(home, items);
  for (const item of items) writeMarkdown(home, item);
  writeVaultReadme(home, items);
  return { repaired: candidates.length, backup };
}

export function normalizeSource(value) {
  if (!value) return null;
  const source = String(value).toLowerCase();
  if (source === "like" || source === "liked" || source === "favorite") {
    return "heart";
  }
  if (source === "bookmarked") return "bookmark";
  return SOURCE_NAMES.has(source) ? source : null;
}

function normalizeRecord(raw, fallbackDate = new Date().toISOString()) {
  if (!raw?.id || !String(raw?.text || "").trim()) return null;

  const sourceCandidates = [
    ...(Array.isArray(raw.sources) ? raw.sources : []),
    raw.source,
  ];
  const sources = [
    ...new Set(sourceCandidates.map(normalizeSource).filter(Boolean)),
  ];
  if (sources.length === 0) sources.push("heart");

  const id = String(raw.id);
  const author = raw.author && typeof raw.author === "object" ? raw.author : {};
  const handle = String(author.handle || raw.handle || "unknown").replace(/^@/, "");
  const postedAt = validDate(raw.postedAt || raw.date) || fallbackDate;
  const savedAt =
    validDate(raw.savedAt || raw.capturedAt || raw.bookmarkedAt || raw.likedAt || raw.liked_at) ||
    fallbackDate;

  return {
    id,
    text: String(raw.text).trim(),
    url: raw.url || raw.sourceUrl || `https://x.com/${handle}/status/${id}`,
    author: {
      id: author.id ? String(author.id) : null,
      handle,
      displayName: author.displayName || author.name || handle,
      avatarUrl: author.avatarUrl || null,
      verified: Boolean(author.verified),
    },
    postedAt,
    savedAt,
    sources,
    likedAt:
      validDate(raw.likedAt || raw.liked_at) ||
      (sources.includes("heart") ? savedAt : null),
    bookmarkedAt:
      validDate(raw.bookmarkedAt || raw.bookmarked_at) ||
      (sources.includes("bookmark") ? savedAt : null),
    sharedAt:
      validDate(raw.sharedAt || raw.shared_at) ||
      (sources.includes("shared") ? savedAt : null),
    links: Array.isArray(raw.links) ? raw.links.filter(Boolean) : [],
    media: Array.isArray(raw.media) ? raw.media.filter(Boolean) : [],
    extraction: normalizeExtraction(raw.extraction),
    demo: Boolean(raw.demo),
    syncedAt: validDate(raw.syncedAt || raw.synced_at) || fallbackDate,
  };
}

function normalizeExtraction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "").toLowerCase();
  if (!status) return null;
  return {
    status,
    url: raw.url || "",
    title: raw.title || "",
    site: raw.site || "",
    description: raw.description || "",
    text: raw.text || "",
    excerpt: raw.excerpt || "",
    imageUrl: raw.imageUrl || "",
    localImage: raw.localImage || "",
    wordCount: Number(raw.wordCount || 0) || 0,
    kind: raw.kind || "",
    reason: raw.reason || "",
    error: raw.error || "",
    extractedAt: validDate(raw.extractedAt) || null,
  };
}

function mergeRecords(previous, next, now) {
  const sources = [...new Set([...previous.sources, ...next.sources])];
  const richer = scoreRichness(next) >= scoreRichness(previous) ? next : previous;
  const likedAt = mergeSourceDate(previous, next, "heart", "likedAt");
  const bookmarkedAt = mergeSourceDate(previous, next, "bookmark", "bookmarkedAt");
  const sharedAt = mergeSourceDate(previous, next, "shared", "sharedAt");

  const merged = {
    ...previous,
    ...richer,
    id: previous.id,
    sources,
    likedAt,
    bookmarkedAt,
    sharedAt,
    extraction: richerExtraction(previous.extraction, next.extraction),
    syncedAt: now,
    demo: Boolean(previous.demo && next.demo),
  };
  merged.savedAt = latestSourceDate(merged) || previous.savedAt || next.savedAt || now;
  return merged;
}

function sameRecord(previous, next) {
  return JSON.stringify({ ...previous, syncedAt: null }) === JSON.stringify({ ...next, syncedAt: null });
}

function mergeSourceDate(previous, next, source, key) {
  if (previous.sources.includes(source)) {
    return previous[key] || previous.savedAt || null;
  }
  if (next.sources.includes(source)) {
    return next[key] || next.savedAt || null;
  }
  return previous[key] || next[key] || null;
}

function sourceDateKey(source) {
  return source === "heart"
    ? "likedAt"
    : source === "bookmark"
      ? "bookmarkedAt"
      : "sharedAt";
}

function latestSourceDate(item) {
  return [item.likedAt, item.bookmarkedAt, item.sharedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
}

function scoreRichness(item) {
  return (
    String(item.text || "").length +
    item.links.length * 40 +
    item.media.length * 40 +
    (item.author?.avatarUrl ? 20 : 0) +
    (item.extraction?.status === "ready" ? 200 + String(item.extraction.text || "").length : 0)
  );
}

function richerExtraction(previous, next) {
  if (!next) return previous || null;
  if (!previous) return next;
  const rank = (value) =>
    value?.status === "ready" ? 3 : value?.status === "skipped" ? 2 : value?.status === "failed" ? 1 : 0;
  if (rank(next) !== rank(previous)) return rank(next) > rank(previous) ? next : previous;
  return String(next.text || "").length >= String(previous.text || "").length ? next : previous;
}

function writeStore(home, items) {
  const target = join(home, STORE_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(items)}\n`, "utf8");
  renameSync(temp, target);
  const stat = statSync(target);
  storeCache.set(target, { mtimeMs: stat.mtimeMs, size: stat.size, items });
}

function writeMarkdown(home, item) {
  const path = join(home, "by-id", `${slugName(item)}.md`);
  writeFileSync(path, toMarkdown(item), "utf8");
}

function removeStaleMarkdown(home, previous, current) {
  const previousPath = join(home, "by-id", `${slugName(previous)}.md`);
  const currentPath = join(home, "by-id", `${slugName(current)}.md`);
  if (previousPath !== currentPath && existsSync(previousPath)) {
    unlinkSync(previousPath);
  }
}

function removeMarkdown(home, item) {
  const exact = join(home, "by-id", `${slugName(item)}.md`);
  if (existsSync(exact)) {
    unlinkSync(exact);
    return;
  }

  const suffix = `-${item.id}.md`;
  const dir = join(home, "by-id");
  for (const name of readdirSync(dir)) {
    if (name.endsWith(suffix)) unlinkSync(join(dir, name));
  }
}

function writeVaultReadme(home, items) {
  const counts = countSources(items);
  writeFileSync(
    join(home, "README.md"),
    `# Momento vault

Your bookmark memory, as plain markdown.

- ${counts.all} unique items
- ${counts.bookmark} bookmarks
- ${counts.heart} hearts still stored, not used for briefs
- ${counts.shared} shared directly

## Search

\`\`\`bash
momento search "pricing" --source bookmark
rg -i "pricing" by-id/
\`\`\`

## Layout

- \`by-id/*.md\` — one file per tweet, plus extracted article text
- \`items.json\` — canonical merged archive
- \`briefs/\` — daily briefs as json + markdown
- \`media/\` — downloaded article images

Briefs and search use bookmarks only.
`,
    "utf8",
  );
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function sortNewestFirst(a, b) {
  return new Date(b.savedAt || b.postedAt) - new Date(a.savedAt || a.postedAt);
}
