import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  absolutize,
  collapseText,
  extractMeta,
  hostFromUrl,
  isHttpUrl,
  isTwitterHost,
  readableText,
} from "./html.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SKIP_HOSTS = new Set([
  "instagram.com",
  "facebook.com",
  "fb.com",
  "tiktok.com",
  "linkedin.com",
  "accounts.google.com",
]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

export function pickExtractUrl(item) {
  const candidates = [
    ...(item?.links || []).map((entry) => entry?.expandedUrl || entry?.url),
    ...urlsFromText(item?.text),
  ];
  for (const candidate of candidates) {
    const url = normalizeCandidate(candidate);
    if (!url) continue;
    const host = hostFromUrl(url);
    if (!host || SKIP_HOSTS.has(host)) continue;
    if (isTwitterHost(host) && !/\/i\/article\//.test(url)) continue;
    return url;
  }
  return null;
}

export async function extractUrl(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal || AbortSignal.timeout(options.timeout || 12_000);
  const target = normalizeCandidate(url);
  if (!target) return skipped("invalid_url", url);

  const host = hostFromUrl(target);
  if (SKIP_HOSTS.has(host)) return skipped("unsupported_host", target);
  if (isYouTube(host)) return extractYouTube(target, fetchImpl, signal);
  if (host === "github.com" || host === "gist.github.com") {
    return extractGithub(target, fetchImpl, signal);
  }

  const response = await fetchImpl(target, {
    redirect: "follow",
    signal,
    headers: {
      "user-agent": BROWSER_UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en",
    },
  });
  const finalUrl = response.url || target;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok) {
    return failed(`HTTP ${response.status}`, finalUrl);
  }
  if (contentType.includes("application/pdf")) {
    return {
      status: "ready",
      url: finalUrl,
      title: titleFromUrl(finalUrl),
      site: hostFromUrl(finalUrl),
      description: "PDF document",
      text: "",
      excerpt: "PDF document",
      imageUrl: "",
      wordCount: 0,
      kind: "pdf",
    };
  }
  if (!contentType.includes("html") && !contentType.includes("xml") && contentType) {
    return skipped(`unsupported_type:${contentType.split(";")[0]}`, finalUrl);
  }

  const html = await response.text();
  const meta = extractMeta(html);
  const text = readableText(html);
  const title = meta.title || titleFromUrl(finalUrl);
  const description = meta.description || excerptOf(text, 280);
  if (!title && !text) return failed("empty_document", finalUrl);

  return {
    status: "ready",
    url: meta.canonical ? absolutize(meta.canonical, finalUrl) || finalUrl : finalUrl,
    title,
    site: meta.site || hostFromUrl(finalUrl),
    description,
    text,
    excerpt: excerptOf(description || text, 420),
    imageUrl: meta.image ? absolutize(meta.image, finalUrl) : "",
    wordCount: wordCount(text),
    kind: "article",
  };
}

export async function downloadImage(url, dest, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  if (!isHttpUrl(url)) return null;
  const response = await fetchImpl(url, {
    redirect: "follow",
    signal: options.signal || AbortSignal.timeout(options.timeout || 10_000),
    headers: { "user-agent": BROWSER_UA, accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
  });
  if (!response.ok || !response.body) return null;
  const type = String(response.headers.get("content-type") || "");
  if (type && !type.startsWith("image/")) return null;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 8 * 1024 * 1024) return null;
  mkdirSync(dirname(dest), { recursive: true });
  const ext = extensionFor(url, type);
  const path = ext && !dest.endsWith(ext) ? `${dest}${ext}` : dest;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  return existsSync(path) ? path : null;
}

export function mediaDir(home) {
  return join(home, "media");
}

export function imageDest(home, id) {
  return join(mediaDir(home), String(id));
}

async function extractYouTube(url, fetchImpl, signal) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("format", "json");
  const response = await fetchImpl(endpoint, { signal, headers: { "user-agent": BROWSER_UA } });
  if (!response.ok) return failed(`youtube ${response.status}`, url);
  const data = await response.json();
  const title = collapseText(data.title || "YouTube video");
  return {
    status: "ready",
    url,
    title,
    site: "YouTube",
    description: collapseText(data.author_name ? `Video by ${data.author_name}` : ""),
    text: title,
    excerpt: title,
    imageUrl: data.thumbnail_url || "",
    wordCount: wordCount(title),
    kind: "video",
  };
}

async function extractGithub(url, fetchImpl, signal) {
  const parsed = new URL(url);
  let raw = "";
  let title = titleFromUrl(url);
  if (parsed.hostname === "gist.github.com") {
    raw = `${url.replace(/\/$/, "")}/raw`;
  } else {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const ref = parts[2] === "tree" || parts[2] === "blob" ? parts[3] : "HEAD";
      const rest =
        parts[2] === "blob" || parts[2] === "tree" ? parts.slice(4).join("/") : "README.md";
      raw = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${ref}/${rest || "README.md"}`;
      title = `${parts[0]}/${parts[1]}`;
    }
  }
  if (!raw) return skipped("github_unresolved", url);
  const response = await fetchImpl(raw, {
    signal,
    headers: { "user-agent": BROWSER_UA, accept: "text/plain,*/*" },
  });
  if (!response.ok) return failed(`github ${response.status}`, url);
  const text = excerptOf(await response.text(), 12_000);
  return {
    status: "ready",
    url,
    title,
    site: "GitHub",
    description: excerptOf(text, 280),
    text,
    excerpt: excerptOf(text, 420),
    imageUrl: "",
    wordCount: wordCount(text),
    kind: "code",
  };
}

function normalizeCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!isHttpUrl(withProtocol)) return "";
  try {
    const url = new URL(withProtocol);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function urlsFromText(text) {
  return String(text || "").match(/https?:\/\/[^\s)]+/gi) || [];
}

function isYouTube(host) {
  return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname);
    return collapseText(last.replace(/[-_]+/g, " ").replace(/\.\w+$/, "")) || parsed.hostname;
  } catch {
    return url;
  }
}

function excerptOf(value, max) {
  const text = collapseText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function wordCount(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function extensionFor(url, contentType) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  const ext = extname(new URL(url, "https://x").pathname).toLowerCase();
  return IMAGE_EXT.has(ext) ? ext : ".jpg";
}

function skipped(reason, url) {
  return { status: "skipped", url: url || "", reason, title: "", site: "", description: "", text: "", excerpt: "", imageUrl: "", wordCount: 0 };
}

function failed(error, url) {
  return { status: "failed", url: url || "", error: String(error), title: "", site: "", description: "", text: "", excerpt: "", imageUrl: "", wordCount: 0 };
}
