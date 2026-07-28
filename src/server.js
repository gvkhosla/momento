import { createServer as createHttpServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { toMarkdown, slugName } from "./format.js";

const MAX_BODY = 12 * 1024 * 1024; // 12mb

export function createServer({ home }) {
  mkdirSync(join(home, "by-id"), { recursive: true });

  return createHttpServer(async (req, res) => {
    // CORS for the chrome extension
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        const known = loadKnownIds(home);
        return json(res, 200, {
          ok: true,
          home,
          total: known.size,
          endpoints: ["GET /health", "GET /known-ids", "GET /search?q=", "POST /ingest"],
        });
      }

      if (req.method === "GET" && url.pathname === "/known-ids") {
        const ids = loadKnownIds(home);
        return json(res, 200, { ids: [...ids] });
      }

      if (req.method === "GET" && url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json(res, 400, { error: "missing q" });
        const { searchVault } = await import("./search.js");
        return json(res, 200, { q, results: searchVault(home, q) });
      }

      if (req.method === "POST" && url.pathname === "/ingest") {
        const body = await readBody(req);
        const payload = JSON.parse(body || "{}");
        const likes = Array.isArray(payload.likes) ? payload.likes : [];
        const result = ingest(home, likes);
        return json(res, 200, result);
      }

      json(res, 404, { error: "not_found" });
    } catch (err) {
      json(res, 500, { error: String(err?.message ?? err) });
    }
  });
}

export function ingest(home, likes) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const known = loadKnownIds(home);
  const paths = loadIdPaths(home);
  const jsonlPath = join(home, "likes.jsonl");
  const now = new Date().toISOString();

  for (const like of likes) {
    if (!like?.id || !like?.text) {
      skipped += 1;
      continue;
    }

    const id = String(like.id);
    const record = {
      ...like,
      id,
      liked_at: like.liked_at || now,
      synced_at: now,
    };

    const preferred = join(home, "by-id", `${slugName(record)}.md`);
    const existingPath = paths.get(id);
    const existed = known.has(id) || Boolean(existingPath && existsSync(existingPath));

    // Drop stale slug file if handle/date changed
    if (existingPath && existingPath !== preferred && existsSync(existingPath)) {
      try {
        unlinkSync(existingPath);
      } catch {
        // ignore
      }
    }

    writeFileSync(preferred, toMarkdown(record), "utf8");
    paths.set(id, preferred);

    if (!existed) {
      appendFileSync(jsonlPath, JSON.stringify(record) + "\n", "utf8");
      inserted += 1;
      known.add(id);
    } else {
      updated += 1;
      known.add(id);
    }
  }

  writeFileSync(join(home, "README.md"), vaultReadme(known.size), "utf8");
  writeKnownIds(home, known);

  return { seen: likes.length, inserted, updated, skipped, total: known.size };
}

function loadIdPaths(home) {
  const dir = join(home, "by-id");
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const id = name.replace(/\.md$/, "").split("-").pop();
    if (id) map.set(id, join(dir, name));
  }
  return map;
}

function loadKnownIds(home) {
  const p = join(home, ".known-ids.json");
  if (!existsSync(p)) {
    // bootstrap from by-id filenames
    const dir = join(home, "by-id");
    if (!existsSync(dir)) return new Set();
    try {
      const files = readdirSync(dir);
      const ids = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, "").split("-").pop())
        .filter(Boolean);
      return new Set(ids);
    } catch {
      return new Set();
    }
  }
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

function writeKnownIds(home, known) {
  writeFileSync(
    join(home, ".known-ids.json"),
    JSON.stringify([...known], null, 0),
    "utf8",
  );
}

function vaultReadme(count) {
  return `# momento vault

${count} likes saved as markdown.

## Search

\`\`\`bash
momento search "pricing"
rg -i "pricing" by-id/
\`\`\`

## Layout

- \`by-id/*.md\` — one file per like (agent-friendly)
- \`likes.jsonl\` — append-only JSON log
- \`.known-ids.json\` — sync cursor helper

Your agent can just grep this folder.
`;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
