import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateLocalAnswer } from "./answer.js";
import { loadSettings, localDateKey } from "./config.js";
import { deepSearchVault } from "./deep-search.js";
import { recentBookmarks } from "./enrich.js";
import { searchItems } from "./search.js";
import { loadItems } from "./store.js";

const CLUSTER_QUERIES = [
  "product strategy pricing distribution growth",
  "ai agents models tools research",
  "engineering systems architecture software",
  "writing design craft taste",
];

export async function buildBrief(home, options = {}) {
  const settings = loadSettings(home);
  const now = options.now || new Date();
  const lookbackHours = Number(options.lookbackHours || settings.lookbackHours || 36);
  const since = new Date(now.getTime() - lookbackHours * 3600_000).toISOString();
  const dateKey = localDateKey(now, settings.timezone);
  const recent = recentBookmarks(home, { since, limit: 24 });
  const corpus = loadItems(home).filter((item) => item.sources?.includes("bookmark"));
  const insights = await gatherInsights(home, corpus, recent, options);
  const evidence = uniqueById([...recent, ...insights]).slice(0, 10);
  const generated = await synthesizeBrief({ dateKey, recent, insights: evidence, lookbackHours }, options);
  const brief = {
    id: dateKey,
    date: dateKey,
    generatedAt: now.toISOString(),
    lookbackHours,
    headline: generated.headline,
    summary: generated.summary,
    insights: generated.insights,
    recents: recent.map(toCard),
    references: evidence.map(toCard),
    podcastScript: generated.podcastScript,
    retrieval: insights.some((item) => item.retrieval === "qmd") ? "qmd" : "keyword",
  };
  writeBrief(home, brief);
  return brief;
}

export function loadBrief(home, dateKey) {
  try {
    const raw = JSON.parse(readFileSync(join(home, "briefs", `${dateKey}.json`), "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export function latestBrief(home) {
  const dates = listBriefs(home);
  return dates[0] ? loadBrief(home, dates[0]) : null;
}

export function listBriefs(home) {
  try {
    return readdirSync(join(home, "briefs"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse()
      .map((name) => name.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

function writeBrief(home, brief) {
  const dir = join(home, "briefs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${brief.date}.json`), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, `${brief.date}.md`), toBriefMarkdown(brief), "utf8");
}

async function gatherInsights(home, corpus, recent, options) {
  const hits = [];
  for (const query of CLUSTER_QUERIES) {
    try {
      const deep = await deepSearchVault(home, query, {
        source: "bookmark",
        limit: 3,
        timeout: options.timeout || 12_000,
      });
      hits.push(...deep);
    } catch {
      hits.push(...searchItems(corpus, query, { source: "bookmark", limit: 3 }));
    }
  }
  return uniqueById([...hits, ...recent]).slice(0, 12);
}

async function synthesizeBrief(context, options) {
  const fallback = fallbackBrief(context);
  if (options.skipModel) return fallback;
  try {
    const result = await generateLocalAnswer(briefQuestion(context), context.insights, {
      model: options.model,
      maxTokens: 420,
    });
    return parseGeneratedBrief(result.answer, fallback);
  } catch {
    return fallback;
  }
}

function briefQuestion(context) {
  const recents = context.recent.length
    ? context.recent.map((item, index) => `${index + 1}. ${cardLine(item)}`).join("\n")
    : "No new bookmarks in this window.";
  return `Write today's private brief from my bookmarks only.

Window: last ${context.lookbackHours} hours. Date: ${context.dateKey}.
New bookmarks:
${recents}

Return exactly this shape:
HEADLINE: <8 words>
SUMMARY: <2 sentences>
INSIGHT 1: <one sentence>
INSIGHT 2: <one sentence>
INSIGHT 3: <one sentence>
PODCAST: <90-140 spoken words, second person, no intro music cues>

Rules: only use the evidence. If nothing new arrived, look for a durable pattern in older bookmarks. Never invent titles.`;
}

function parseGeneratedBrief(answer, fallback) {
  const text = String(answer || "");
  const headline = capture(text, /HEADLINE:\s*(.+)/i) || fallback.headline;
  const summary = capture(text, /SUMMARY:\s*([\s\S]*?)(?:\nINSIGHT|\nPODCAST:|$)/i) || fallback.summary;
  const insights = [1, 2, 3]
    .map((index) => capture(text, new RegExp(`INSIGHT ${index}:\\s*(.+)`, "i")))
    .filter(Boolean);
  const podcastScript = capture(text, /PODCAST:\s*([\s\S]*?)(?:\nSources:|$)/i) || fallback.podcastScript;
  return {
    headline: cleanLine(headline),
    summary: cleanLine(summary),
    insights: insights.length ? insights.map(cleanLine) : fallback.insights,
    podcastScript: cleanLine(podcastScript),
  };
}

function fallbackBrief(context) {
  const recent = context.recent;
  const insights = context.insights;
  if (recent.length === 0) {
    const top = insights[0];
    return {
      headline: "Patterns in what you keep",
      summary:
        "No new bookmarks landed in this window. Momento reread the archive and pulled a durable thread from older saves.",
      insights: insights.slice(0, 3).map((item) => cardLine(item) || "A saved bookmark is still waiting to be reused."),
      podcastScript: `Nothing new landed in the last ${context.lookbackHours} hours, so this is a reread. ${
        top ? `Start with ${cardLine(top)}.` : "Open the archive and pick one old bookmark to act on today."
      } The point of Momento is not more saving. It is making one saved thing useful again.`,
    };
  }
  const first = recent[0];
  return {
    headline: recent.length === 1 ? "One bookmark worth keeping" : `${recent.length} bookmarks since yesterday`,
    summary: `You saved ${recent.length} bookmark${recent.length === 1 ? "" : "s"} in the last ${context.lookbackHours} hours, starting with ${cardLine(first)}.`,
    insights: recent.slice(0, 3).map((item) => cardLine(item)),
    podcastScript: `You bookmarked ${recent.length} thing${recent.length === 1 ? "" : "s"} since yesterday. ${recent
      .slice(0, 3)
      .map((item) => cardLine(item))
      .join(" ")} Pick one and do something with it today. The rest can wait in the vault.`,
  };
}

export function cardLine(item) {
  const extracted = item.extraction || {};
  const title = extracted.title || excerpt(item.text, 90);
  const site = extracted.site || item.author?.handle || "bookmark";
  return `${title} — ${site}`;
}

export function toCard(item) {
  const extracted = item.extraction || {};
  return {
    id: item.id,
    url: extracted.url || item.url,
    tweetUrl: item.url,
    title: extracted.title || excerpt(item.text, 120),
    site: extracted.site || item.author?.handle || "",
    excerpt: extracted.excerpt || excerpt(item.text, 220),
    imageUrl: extracted.imageUrl || item.media?.[0]?.url || "",
    author: item.author,
    postedAt: item.postedAt,
    bookmarkedAt: item.bookmarkedAt || item.savedAt,
    status: extracted.status || "pending",
  };
}

function toBriefMarkdown(brief) {
  const recents = brief.recents
    .map((item) => `- [${item.title}](${item.url}) — ${item.site}`)
    .join("\n");
  const insights = brief.insights.map((line) => `- ${line}`).join("\n");
  return `# ${brief.headline}

_${brief.date}_

${brief.summary}

## Insights

${insights || "- Nothing new to surface."}

## New bookmarks

${recents || "- None in this window."}

## Podcast script

${brief.podcastScript}
`;
}

function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function excerpt(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled bookmark";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function capture(text, regex) {
  return text.match(regex)?.[1]?.trim() || "";
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s+/, "")
    .trim();
}
