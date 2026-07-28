import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function searchVault(home, query) {
  const dir = join(home, "by-id");
  if (!existsSync(dir)) return [];

  if (hasBin("rg")) {
    return searchWithRg(dir, query);
  }
  return searchNaive(dir, query);
}

export function statsVault(home) {
  const dir = join(home, "by-id");
  if (!existsSync(dir)) return { count: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const dates = files
    .map((f) => f.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return {
    count: files.length,
    oldest: dates[0] || null,
    newest: dates[dates.length - 1] || null,
  };
}

function searchWithRg(dir, query) {
  let out = "";
  try {
    out = execFileSync(
      "rg",
      [
        "-i",
        "--no-heading",
        "--with-filename",
        "--line-number",
        "--max-count",
        "3",
        "-g",
        "*.md",
        query,
        dir,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    // rg exits 1 on no matches
    if (err?.status === 1) return [];
    throw err;
  }

  /** @type {Map<string, {file:string, lines:string[]}>} */
  const byFile = new Map();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, , text] = m;
    if (!byFile.has(file)) byFile.set(file, { file, lines: [] });
    const entry = byFile.get(file);
    if (entry.lines.length < 2) entry.lines.push(text.trim());
  }

  return [...byFile.values()].map((e) => hitFromFile(e.file, e.lines.join(" · ")));
}

function searchNaive(dir, query) {
  const q = query.toLowerCase();
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const file = join(dir, name);
    const body = readFileSync(file, "utf8");
    if (!body.toLowerCase().includes(q)) continue;
    const idx = body.toLowerCase().indexOf(q);
    const start = Math.max(0, idx - 40);
    const snippet = body
      .slice(start, start + 120)
      .replace(/\s+/g, " ")
      .trim();
    hits.push(hitFromFile(file, snippet));
    if (hits.length >= 50) break;
  }
  return hits;
}

function hitFromFile(file, snippet) {
  let body = "";
  try {
    body = readFileSync(file, "utf8");
  } catch {
    body = "";
  }
  const author = matchFm(body, "author") || "";
  const url = matchFm(body, "url") || "";
  const date = matchFm(body, "date") || "";
  const textLine =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("---") && !l.includes(": ") && !l.startsWith("#")) || "";

  const title = [date.slice(0, 10), author, truncate(textLine, 72)]
    .filter(Boolean)
    .join(" · ");

  return {
    file,
    url,
    title,
    snippet: truncate(snippet || textLine, 140),
  };
}

function matchFm(body, key) {
  const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!m) return null;
  const v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

function truncate(s, n) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function hasBin(name) {
  const r = spawnSync(name, ["--version"], { stdio: "ignore" });
  return r.status === 0 || r.status === null;
}
