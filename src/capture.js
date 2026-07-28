import { ingestItems } from "./store.js";

const X_URL = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/i;

export async function captureUrl(home, rawUrl, source = "bookmark") {
  const match = String(rawUrl || "").match(X_URL);
  if (!match) throw new Error("Paste a valid x.com tweet URL.");

  const canonicalUrl = `https://x.com/${match[1]}/status/${match[2]}`;
  const item = await fetchTweet(canonicalUrl, match[1], match[2], source);
  const result = ingestItems(home, [item]);
  return { item, ...result };
}

async function fetchTweet(url, handle, id, source) {
  let text = "Saved from X";
  let displayName = handle;

  try {
    const endpoint = new URL("https://publish.twitter.com/oembed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("dnt", "true");
    const response = await fetch(endpoint, {
      headers: { "user-agent": "momento/0.2" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      text = extractBlockquote(data.html) || text;
      displayName = data.author_name || displayName;
    }
  } catch {
    // A URL-only record is still useful and can be enriched on the next extension sync.
  }

  const now = new Date().toISOString();
  return {
    id,
    text,
    url,
    postedAt: now,
    savedAt: now,
    source,
    author: { handle, displayName },
  };
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
