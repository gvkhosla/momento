const BLOCK_BREAK = /<\/(p|div|h[1-6]|li|br|blockquote|tr|section|article)[^>]*>/gi;
const DROP_BLOCKS =
  /<(script|style|noscript|svg|canvas|iframe|form|nav|footer|header|aside|button)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;

export function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeChar(parseInt(code, 16)));
}

export function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(DROP_BLOCKS, " ")
      .replace(BLOCK_BREAK, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(TAG, " "),
  );
}

export function collapseText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractMeta(html) {
  const source = String(html || "");
  const property = (name) =>
    firstMatch(source, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["']`, "i")) ||
    firstMatch(source, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegExp(name)}["']`, "i"));

  const title =
    property("og:title") ||
    property("twitter:title") ||
    decodeEntities(firstMatch(source, /<title[^>]*>([\s\S]*?)<\/title>/i) || "");

  return {
    title: collapseText(title),
    description: collapseText(property("og:description") || property("twitter:description") || property("description")),
    image: decodeEntities(property("og:image") || property("twitter:image") || ""),
    site: collapseText(property("og:site_name") || ""),
    canonical: decodeEntities(
      firstMatch(source, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
        firstMatch(source, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i) ||
        "",
    ),
  };
}

export function extractArticleHtml(html) {
  const source = String(html || "");
  const article = firstMatch(source, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article) return article;
  const main = firstMatch(source, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main;
  return source;
}

export function readableText(html, { maxChars = 12_000 } = {}) {
  const raw = collapseText(stripTags(extractArticleHtml(html)));
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const kept = [];
  for (const line of lines) {
    if (isBoilerplate(line)) continue;
    kept.push(line);
  }
  const text = kept.join("\n\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}…`;
}

export function hostFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function absolutize(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isTwitterHost(host) {
  const name = String(host || "").replace(/^www\./, "").toLowerCase();
  return name === "x.com" || name === "twitter.com" || name === "t.co" || name === "mobile.twitter.com" || name === "nitter.net";
}

function isBoilerplate(line) {
  if (line.length < 12) return true;
  if (/^(cookie|accept all|sign in|subscribe|share this|advertisement|related articles)\b/i.test(line)) {
    return true;
  }
  const words = line.split(/\s+/);
  if (words.length < 4 && line.length < 40) return true;
  return false;
}

function firstMatch(source, regex) {
  return source.match(regex)?.[1] || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 32) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
