#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, ingest } from "./server.js";
import { searchVault, statsVault } from "./search.js";
import { DEMO_LIKES } from "./seed.js";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`momento ${VERSION} — your X likes as plain searchable files

Usage:
  momento serve [--port 4177] [--home DIR]   Start local ingest server
  momento search <query> [--home DIR]        Search likes
  momento stats [--home DIR]                 Count + newest/oldest
  momento seed [--home DIR]                  Load a few demo likes (no X needed)
  momento path [--home DIR]                  Print vault directory
  momento open [--home DIR]                  Open vault in Finder
  momento help

Test path:
  1. momento serve
  2. Chrome → Load unpacked → momento/extension
  3. Sign in to x.com → extension popup → Sync likes
  4. momento search "whatever you remember"

Env:
  MOMENTO_HOME   Vault directory (default: ~/momento-vault)
  MOMENTO_PORT   Server port (default: 4177)
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" || a === "--port") {
      args[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--home=")) {
      args.home = a.slice(7);
    } else if (a.startsWith("--port=")) {
      args.port = a.slice(7);
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function resolveHome(flag) {
  const raw = flag || process.env.MOMENTO_HOME || join(homedir(), "momento-vault");
  return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}

function ensureHome(home) {
  mkdirSync(join(home, "by-id"), { recursive: true });
  return home;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";

  if (args.help || cmd === "help" || cmd === "-h") {
    printHelp();
    return;
  }

  const home = resolveHome(args.home);

  if (cmd === "path") {
    console.log(home);
    return;
  }

  if (cmd === "open") {
    ensureHome(home);
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer"
          : "xdg-open";
    spawn(opener, [home], { detached: true, stdio: "ignore" }).unref();
    console.log(home);
    return;
  }

  if (cmd === "stats") {
    ensureHome(home);
    const s = statsVault(home);
    console.log(`${s.count} likes`);
    if (s.newest) console.log(`newest: ${s.newest}`);
    if (s.oldest) console.log(`oldest: ${s.oldest}`);
    console.log(`vault:  ${home}`);
    return;
  }

  if (cmd === "seed") {
    ensureHome(home);
    const result = ingest(home, DEMO_LIKES);
    console.log(
      `seeded ${result.inserted} new, ${result.updated} updated (total ${result.total})`,
    );
    console.log(`vault: ${home}`);
    console.log(`try:   momento search pricing`);
    return;
  }

  if (cmd === "search") {
    const query = args._.slice(1).join(" ").trim();
    if (!query) {
      console.error("usage: momento search <query>");
      process.exit(1);
    }
    ensureHome(home);
    const hits = searchVault(home, query);
    if (hits.length === 0) {
      console.log("No matches.");
      console.log(`vault: ${home}`);
      console.log("tip: momento seed   # demo data, or sync via the extension");
      return;
    }
    for (const h of hits) {
      console.log(`\n${h.title}`);
      console.log(`  ${h.url}`);
      if (h.snippet) console.log(`  ${h.snippet}`);
      console.log(`  ${h.file}`);
    }
    console.log(`\n${hits.length} match${hits.length === 1 ? "" : "es"}`);
    return;
  }

  if (cmd === "serve") {
    const port = Number(args.port || process.env.MOMENTO_PORT || 4177);
    ensureHome(home);
    const server = createServer({ home, port });
    server.on("error", (err) => {
      if (err?.code === "EADDRINUSE") {
        console.error(`port ${port} already in use — is momento already running?`);
        process.exit(1);
      }
      throw err;
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`momento listening on http://127.0.0.1:${port}`);
      console.log(`vault → ${home}`);
      console.log(`extension → ${resolve(join(import.meta.dirname, "..", "extension"))}`);
      console.log(`load that folder unpacked in Chrome, then Sync likes`);
    });
    return;
  }

  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
