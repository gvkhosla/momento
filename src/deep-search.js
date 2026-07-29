import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { slugName } from "./format.js";
import { loadItems } from "./store.js";

const execFileAsync = promisify(execFile);
const DEFAULT_COLLECTION = "momento";

export async function deepSearchVault(home, query, options = {}) {
  const collection = options.collection || process.env.MOMENTO_QMD_COLLECTION || DEFAULT_COLLECTION;
  const limit = Math.min(100, Math.max(1, Number(options.limit || 50)));
  const candidateLimit = Math.min(200, Math.max(limit, limit * 3));
  const structuredQuery = `lex: ${query}\nvec: ${query}`;
  const args = [
    "query",
    "-c",
    collection,
    "-n",
    String(candidateLimit),
    "--format",
    "json",
    ...(options.rerank ? [] : ["--no-rerank"]),
    structuredQuery,
  ];

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.env.MOMENTO_QMD_BIN || "qmd", args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(options.timeout || 120_000),
    }));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${deepSetupMessage(home)}\n\nQMD is not installed.`);
    }
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`${deepSetupMessage(home)}${detail ? `\n\nQMD said: ${detail}` : ""}`);
  }

  const qmdResults = parseJsonArray(stdout);
  const items = loadItems(home);
  const byFilename = new Map(items.map((item) => [`${slugName(item)}.md`, item]));
  const source = options.source && options.source !== "all" ? options.source : null;
  const seen = new Set();
  const results = [];

  for (const result of qmdResults) {
    const filename = filenameFromQmdPath(result.file);
    const item = byFilename.get(filename);
    if (!item || seen.has(item.id)) continue;
    if (source && !item.sources.includes(source)) continue;
    seen.add(item.id);
    results.push({
      ...item,
      score: Number(result.score || 0),
      retrieval: "qmd",
      snippet: result.snippet || null,
    });
    if (results.length >= limit) break;
  }

  return results;
}

export function deepSetupMessage(home) {
  const collection = process.env.MOMENTO_QMD_COLLECTION || DEFAULT_COLLECTION;
  return `Deep search needs a manually managed QMD index. Run:\n\n  bun install -g @tobilu/qmd\n  qmd collection add "${home}/by-id" --name ${collection} --mask '**/*.md'\n  qmd embed\n\nAfter future Momento syncs, refresh it manually with:\n\n  qmd update\n  qmd embed`;
}

function parseJsonArray(value) {
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  if (start === -1 || end < start) throw new Error("QMD returned no JSON results.");
  const parsed = JSON.parse(value.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("QMD returned an unexpected result.");
  return parsed;
}

function filenameFromQmdPath(value) {
  const withoutQuery = String(value || "").split("?")[0];
  const encoded = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
