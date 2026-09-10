import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { saveState } from "./config.js";

const execFileAsync = promisify(execFile);
export const DEFAULT_COLLECTION = "momento";

export async function refreshIndex(home, options = {}) {
  const collection = options.collection || process.env.MOMENTO_QMD_COLLECTION || DEFAULT_COLLECTION;
  const bin = process.env.MOMENTO_QMD_BIN || "qmd";
  await ensureCollection(home, collection, bin);
  await runQmd(bin, ["update", "-c", collection], options);
  await runQmd(bin, ["embed", "-c", collection], { ...options, timeout: options.embedTimeout || 10 * 60_000 });
  saveState(home, { lastIndexAt: new Date().toISOString() });
  return { collection, ok: true };
}

export function indexSetupMessage(home) {
  const collection = process.env.MOMENTO_QMD_COLLECTION || DEFAULT_COLLECTION;
  return `Momento indexes ${home}/by-id into QMD collection "${collection}". Install once:\n\n  bun install -g @tobilu/qmd\n  qmd collection add "${home}/by-id" --name ${collection} --mask '**/*.md'\n\nMomento then runs \`qmd update\` and \`qmd embed\` after enriching bookmarks.`;
}

async function ensureCollection(home, collection, bin) {
  const listed = await runQmd(bin, ["collection", "list"], { ignoreFailure: true });
  if (listed.ok && listed.stdout.includes(`${collection} (`)) return;
  const result = await runQmd(bin, ["collection", "add", join(home, "by-id"), "--name", collection, "--mask", "**/*.md"], {
    ignoreFailure: true,
  });
  if (!result.ok && !/already exists|exists/i.test(result.stderr + result.stdout)) {
    throw new Error(`${indexSetupMessage(home)}\n\nCould not create QMD collection "${collection}".`);
  }
}

async function runQmd(bin, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(options.timeout || 120_000),
      env: {
        ...process.env,
        HOME: process.env.HOME || homedir(),
      },
    });
    return { ok: true, stdout: stdout || "", stderr: stderr || "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${indexSetupMessage(options.home || "")}\n\nQMD is not installed.`);
    }
    if (options.ignoreFailure) {
      return { ok: false, stdout: String(error?.stdout || ""), stderr: String(error?.stderr || error?.message || "") };
    }
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(detail || `qmd ${args.join(" ")} failed`);
  }
}

export function writeIndexHint(home) {
  mkdirSync(home, { recursive: true });
  const hint = join(home, ".qmd-hint");
  if (!existsSync(hint)) writeFileSync(hint, "managed by momento enrich/index\n");
}
