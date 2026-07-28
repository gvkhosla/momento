import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { slugName, toMarkdown } from "./format.js";

const STORE_FILE = "items.json";
const SOURCE_NAMES = new Set(["heart", "bookmark", "shared"]);

export function ensureVault(home) {
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "by-id"), { recursive: true });
}

export function loadItems(home) {
  ensureVault(home);
  const path = join(home, STORE_FILE);
  if (!existsSync(path)) return [];

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data.map(normalizeRecord).filter(Boolean) : [];
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
  let skipped = incoming.length - validIncoming.length;
  const changed = [];

  for (const next of validIncoming) {
    const previous = byId.get(next.id);
    const merged = previous ? mergeRecords(previous, next, now) : next;
    byId.set(next.id, merged);
    changed.push({ previous, current: merged });
    if (previous) updated += 1;
    else inserted += 1;
  }

  const items = [...byId.values()].sort(sortNewestFirst);
  writeStore(home, items);

  for (const demo of demosToRemove) removeMarkdown(home, demo);
  for (const { previous, current } of changed) {
    if (previous) removeStaleMarkdown(home, previous, current);
    writeMarkdown(home, current);
  }

  writeVaultReadme(home, items);

  return {
    seen: incoming.length,
    inserted,
    updated,
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
    demo: Boolean(raw.demo),
    syncedAt: validDate(raw.syncedAt || raw.synced_at) || fallbackDate,
  };
}

function mergeRecords(previous, next, now) {
  const sources = [...new Set([...previous.sources, ...next.sources])];
  const richer = scoreRichness(next) >= scoreRichness(previous) ? next : previous;

  return {
    ...previous,
    ...richer,
    id: previous.id,
    sources,
    likedAt: next.likedAt || previous.likedAt || null,
    bookmarkedAt: next.bookmarkedAt || previous.bookmarkedAt || null,
    sharedAt: next.sharedAt || previous.sharedAt || null,
    savedAt: latestDate(previous.savedAt, next.savedAt) || now,
    syncedAt: now,
    demo: Boolean(previous.demo && next.demo),
  };
}

function scoreRichness(item) {
  return (
    String(item.text || "").length +
    item.links.length * 40 +
    item.media.length * 40 +
    (item.author?.avatarUrl ? 20 : 0)
  );
}

function writeStore(home, items) {
  const target = join(home, STORE_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(temp, target);
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

Your X memory, as plain markdown.

- ${counts.all} unique items
- ${counts.bookmark} bookmarks
- ${counts.heart} hearts
- ${counts.shared} shared directly

## Search

\`\`\`bash
momento search "pricing"
rg -i "pricing" by-id/
\`\`\`

## Layout

- \`by-id/*.md\` — one file per tweet
- \`items.json\` — canonical merged archive

A tweet can be both hearted and bookmarked without being duplicated.
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
