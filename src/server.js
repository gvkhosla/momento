import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { generateLocalAnswer } from "./answer.js";
import { captureUrl } from "./capture.js";
import { searchItems, searchVault, statsVault } from "./search.js";
import {
  countSources,
  getKnownIds,
  ingestItems,
  loadItems,
} from "./store.js";

const MAX_BODY = 12 * 1024 * 1024;
const LEGACY_PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const SHADCN_PUBLIC_DIR = fileURLToPath(new URL("../web/out", import.meta.url));
const PUBLIC_DIR = existsSync(join(SHADCN_PUBLIC_DIR, "index.html"))
  ? SHADCN_PUBLIC_DIR
  : LEGACY_PUBLIC_DIR;
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function createServer({ home, token = process.env.MOMENTO_TOKEN || "" }) {
  let phoneToken = "";
  let answering = false;

  return createHttpServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return empty(res, 204);

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      if (req.method === "POST" && pathname === "/api/phone-session") {
        if (!isLocalRequest(req) || isTunnelRequest(req)) {
          return json(res, 403, { error: "local_only" });
        }
        phoneToken = randomBytes(24).toString("base64url");
        return json(res, 200, { token: phoneToken });
      }

      if (req.method === "GET" && pathname === "/" && url.searchParams.get("token")) {
        const supplied = url.searchParams.get("token");
        if (phoneToken && supplied === phoneToken) {
          res.writeHead(303, {
            location: "/",
            "set-cookie": `momento_phone=${phoneToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          });
          return res.end();
        }
      }

      if (pathname.startsWith("/api/") && !isAuthorized(req, url, token, phoneToken)) {
        return json(res, 401, { error: "unauthorized" });
      }

      if (req.method === "GET" && pathname === "/api/health") {
        const items = loadItems(home);
        return json(res, 200, {
          ok: true,
          home,
          total: items.length,
          counts: countSources(items),
          protected: Boolean(token || (phoneToken && isTunnelRequest(req))),
        });
      }

      if (req.method === "GET" && pathname === "/api/items") {
        const items = loadItems(home);
        const q = url.searchParams.get("q") || "";
        const source = url.searchParams.get("source") || "all";
        const limit = url.searchParams.get("limit") || "100";
        const offset = url.searchParams.get("offset") || "0";
        const results = searchItems(items, q, { source, limit, offset });
        return json(res, 200, {
          q,
          source,
          results,
          total: results.length,
          counts: countSources(items),
        });
      }

      if (req.method === "GET" && pathname === "/api/stats") {
        return json(res, 200, statsVault(home));
      }

      if (req.method === "POST" && pathname === "/api/ask") {
        if (answering) return json(res, 409, { error: "Momento is already answering another question." });
        const payload = await readPayload(req);
        const question = String(payload.question || "").trim();
        if (!question) return json(res, 400, { error: "Ask a question first." });
        const source = payload.source || "all";
        const evidence = searchVault(home, question, {
          source,
          limit: Math.min(10, Math.max(1, Number(payload.limit || 6))),
        });
        if (evidence.length === 0) {
          return json(res, 404, { error: "Nothing in your archive matched that question." });
        }

        answering = true;
        try {
          const result = await generateLocalAnswer(question, evidence, {
            model: payload.model,
            maxTokens: 420,
          });
          return json(res, 200, {
            answer: result.answer,
            evidence: evidence.map((item) => ({ id: item.id, url: item.url })),
            retrieval: "keyword",
            local: true,
          });
        } finally {
          answering = false;
        }
      }

      if (req.method === "GET" && pathname === "/api/known-ids") {
        const source = url.searchParams.get("source");
        return json(res, 200, { ids: getKnownIds(home, source) });
      }

      if (req.method === "POST" && pathname === "/api/ingest") {
        const payload = await readPayload(req);
        const items = Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.likes)
            ? payload.likes
            : Array.isArray(payload.bookmarks)
              ? payload.bookmarks
              : [];
        return json(res, 200, ingestItems(home, items));
      }

      if (req.method === "POST" && pathname === "/api/capture") {
        const payload = await readPayload(req);
        const result = await captureUrl(
          home,
          payload.url || payload.text,
          payload.source || "bookmark",
        );
        return json(res, 200, result);
      }

      if ((req.method === "POST" || req.method === "GET") && pathname === "/share") {
        if (!isAuthorized(req, url, token, phoneToken)) {
          return json(res, 401, { error: "unauthorized" });
        }
        const payload =
          req.method === "POST"
            ? await readPayload(req)
            : Object.fromEntries(url.searchParams.entries());
        await captureUrl(
          home,
          payload.url || payload.text || payload.title,
          payload.source || "bookmark",
        );
        res.writeHead(303, { location: "/?captured=1" });
        return res.end();
      }

      // Backward compatibility for the v0.1 extension.
      if (req.method === "GET" && pathname === "/health") {
        const items = loadItems(home);
        return json(res, 200, { ok: true, home, total: items.length, counts: countSources(items) });
      }
      if (req.method === "GET" && pathname === "/known-ids") {
        return json(res, 200, { ids: getKnownIds(home, url.searchParams.get("source")) });
      }
      if (req.method === "POST" && pathname === "/ingest") {
        const payload = await readPayload(req);
        return json(res, 200, ingestItems(home, payload.likes || payload.items || []));
      }

      if (req.method === "GET" || req.method === "HEAD") {
        return serveStatic(req, res, pathname);
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /valid x\.com|Paste/.test(message) ? 400 : 500;
      return json(res, status, { error: message });
    }
  });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let path = join(PUBLIC_DIR, safe);

  if (!path.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(PUBLIC_DIR, "index.html");
  if (!existsSync(path)) return json(res, 404, { error: "not_found" });

  const stat = statSync(path);
  res.writeHead(200, {
    "content-type": MIME[extname(path)] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(path).pipe(res);
}

function isAuthorized(req, url, configuredToken, phoneToken) {
  const required = configuredToken || (isTunnelRequest(req) ? phoneToken : "");
  if (!required) return true;
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const cookie = parseCookies(req.headers.cookie || "").momento_phone;
  return header === required || url.searchParams.get("token") === required || cookie === required;
}

function isTunnelRequest(req) {
  return Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s))
      .filter(([key]) => key),
  );
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function json(res, status, object) {
  const body = JSON.stringify(object);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function empty(res, status) {
  res.writeHead(status);
  res.end();
}

async function readPayload(req) {
  const body = await readBody(req);
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) return JSON.parse(body || "{}");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body).entries());
  }
  return { text: body };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
