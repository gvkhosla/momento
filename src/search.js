import { loadItems } from "./store.js";

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "by",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "tweet",
  "tweets",
  "was",
  "what",
  "with",
]);

export function searchVault(home, query, options = {}) {
  return searchItems(loadItems(home), query, options);
}

export function searchItems(items, query, options = {}) {
  const source = options.source && options.source !== "all" ? options.source : null;
  const limit = clamp(Number(options.limit || 100), 1, 500);
  const offset = Math.max(0, Number(options.offset || 0));
  const normalizedQuery = normalize(query || "");
  const tokens = tokenize(normalizedQuery);

  const candidates = items.filter(
    (item) => !source || item.sources?.includes(source),
  );

  const scored = candidates
    .map((item) => ({ item, score: scoreItem(item, normalizedQuery, tokens) }))
    .filter(({ score }) => !normalizedQuery || score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return sortDate(b.item, source) - sortDate(a.item, source);
    });

  return scored.slice(offset, offset + limit).map(({ item, score }) => ({
    ...item,
    score,
  }));
}

export function statsVault(home) {
  const items = loadItems(home);
  const dates = items
    .map((item) => item.postedAt || item.savedAt)
    .filter(Boolean)
    .sort();
  const counts = { all: items.length, heart: 0, bookmark: 0, shared: 0 };
  for (const item of items) {
    for (const source of item.sources || []) {
      if (source in counts) counts[source] += 1;
    }
  }

  return {
    count: items.length,
    counts,
    oldest: dates[0]?.slice(0, 10) || null,
    newest: dates.at(-1)?.slice(0, 10) || null,
  };
}

function scoreItem(item, phrase, tokens) {
  if (!phrase) return 1;

  const text = normalize(item.text || "");
  const author = normalize(
    `${item.author?.displayName || ""} ${item.author?.handle || ""}`,
  );
  const links = normalize(
    (item.links || [])
      .map((entry) => `${entry.title || ""} ${entry.expandedUrl || entry.url || ""}`)
      .join(" "),
  );
  const full = `${author} ${text} ${links}`;
  let score = 0;

  if (text.includes(phrase)) score += 20;
  if (author.includes(phrase)) score += 16;
  if (links.includes(phrase)) score += 10;

  for (const token of tokens) {
    if (author.includes(token)) score += 7;
    if (text.includes(token)) score += 5;
    if (links.includes(token)) score += 3;
    if (full.split(/\s+/).some((word) => word.startsWith(token))) score += 1;
  }

  if (tokens.length > 1 && tokens.every((token) => full.includes(token))) score += 8;
  return score;
}

function tokenize(value) {
  const useful = value
    .split(/[^a-z0-9_@]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return useful.length > 0 ? [...new Set(useful)] : value ? [value] : [];
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function sortDate(item, source) {
  const value =
    source === "bookmark"
      ? item.bookmarkedAt
      : source === "heart"
        ? item.likedAt
        : source === "shared"
          ? item.sharedAt
          : item.savedAt;
  const timestamp = new Date(value || item.savedAt || item.postedAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
