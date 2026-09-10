import { createHash } from "node:crypto";
import { enrichRecords } from "./enrich.js";
import { extractUrl } from "./extract.js";
import { hostFromUrl } from "./html.js";
import { ingestItems } from "./store.js";

const X_STATUS = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d+)/i;
const ANY_URL = /https?:\/\/[^\s<>"')]+/i;

export async function captureUrl(home, rawInput, source = "bookmark", options = {}) {
  const raw = String(rawInput || "").trim();
  const url = firstUrl(raw);
  if (!url) throw new Error("Paste a link to remember.");

  const tweet = url.match(X_STATUS);
  const item = tweet
    ? await fetchTweet(url, tweet[1], tweet[2], source)
    : await fetchPageBookmark(url, source, options);

  const result = ingestItems(home, [item]);
  const stored = result.inserted || result.updated ? item : item;
  let enriched = stored;
  try {
    const records = await enrichRecords(home, [stored], { ...options, index: options.index !== false });
    enriched = records[0] || stored;
  } catch {
    enriched = stored;
  }
  return { item: enriched, ...result };
}

export function firstUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(ANY_URL);
  if (match) return stripTrailing(match[0]);
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text)) return `https://${text}`;
  return "";
}

async function fetchTweet(url, handle, id, source) {
  const canonicalUrl = `https://x.com/${handle}/status/${id}`;
  let text = "Saved from X";
  let displayName = handle;
  const links = [];

  try {
    const endpoint = new URL("https://publish.twitter.com/oembed");
    endpoint.searchParams.set("url", canonicalUrl);
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("dnt", "true");
    const response = await fetch(endpoint, {
      headers: { "user-agent": "momento/0.4" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      text = extractBlockquote(data.html) || text;
      displayName = data.author_name || displayName;
      for (const found of text.match(/https?:\/\/[^\s]+/g) || []) {
        links.push({ url: found, expandedUrl: found, title: null });
      }
    }
  } catch {
    // A URL-only record is still useful and can be enriched on the next pass.
  }

  const now = new Date().toISOString();
  return {
    id,
    text,
    url: canonicalUrl,
    postedAt: now,
    savedAt: now,
    source,
    author: { handle, displayName },
    links,
  };
}

async function fetchPageBookmark(url, source, options) {
  const now = new Date().toISOString();
  const extracted = await extractUrl(url, options).catch(() => null);
  const finalUrl = extracted?.url || url;
  const host = extracted?.site || hostFromUrl(finalUrl) || "web";
  const title = extracted?.title || host;
  const text = extracted?.excerpt || extracted?.text || title;
  return {
    id: urlId(finalUrl),
    text,
    url: finalUrl,
    postedAt: now,
    savedAt: now,
    source,
    author: { handle: host.replace(/\./g, "_"), displayName: host },
    links: [{ url: finalUrl, expandedUrl: finalUrl, title }],
    extraction: extracted?.status === "ready" ? { ...extracted, extractedAt: now } : null,
  };
}

export function urlId(value) {
  const digest = createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
  return `url-${digest}`;
}

function stripTrailing(value) {
  return String(value).replace(/[),.;]+$/g, "");
}

function extractBlockquote(html = "") {
  const paragraph = String(html).match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
  return decodeEntities(
    paragraph
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ");
}
