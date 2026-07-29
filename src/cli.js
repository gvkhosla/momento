#!/usr/bin/env node
import { spawn } from "node:child_process";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { answerWithLocalModel } from "./answer.js";
import { deepSearchVault, deepSetupMessage } from "./deep-search.js";
import { createServer } from "./server.js";
import { searchVault, statsVault } from "./search.js";
import {
  clearDemo,
  ensureVault,
  ingestItems,
  repairLegacySourceOrder,
} from "./store.js";
import { DEMO_ITEMS } from "./seed.js";

const VERSION = "0.3.0";

function printHelp() {
  console.log(`momento ${VERSION} — remember what you saved on X

Usage:
  momento serve [--port 4177] [--home DIR]   Start the app + sync API
  momento phone [--port 4177]                Open a secure phone tunnel
  momento search <query> [--source TYPE]     Instant local keyword search
  momento search <query> --deep              QMD hybrid lexical + vector search
  momento ask <question> [--deep]            Answer from saved posts locally
  momento deep-setup                         Print the private QMD setup steps
  momento repair-order --source TYPE         Repair pre-v0.3 crawl ordering
  momento stats [--home DIR]                 Archive counts
  momento seed [--home DIR]                  Load demo items
  momento clear-demo [--home DIR]            Remove demo items
  momento path [--home DIR]                  Print vault directory
  momento open [--home DIR]                  Open vault in Finder

Sources: all, bookmark, heart, shared
Local answers use llama-cli and MOMENTO_MODEL (a GGUF instruct model).

Quick start:
  momento seed
  momento serve
  open http://localhost:4177
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--home", "--port", "--source", "--token", "--model", "--limit", "--collection"].includes(arg)) {
      args[arg.slice(2)] = argv[++i];
    } else if (["--deep", "--rerank"].includes(arg)) {
      args[arg.slice(2)] = true;
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const [key, value] = arg.slice(2).split(/=(.*)/s);
      args[key] = value;
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function resolveHome(flag) {
  const raw = flag || process.env.MOMENTO_HOME || join(homedir(), "momento-vault");
  return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  if (args.help || command === "help") return printHelp();

  const home = resolveHome(args.home);
  ensureVault(home);

  if (command === "path") return console.log(home);

  if (command === "open") {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    spawn(opener, [home], { detached: true, stdio: "ignore" }).unref();
    return console.log(home);
  }

  if (command === "seed") {
    const result = ingestItems(home, DEMO_ITEMS, { removeDemo: false });
    console.log(`Demo ready: ${result.total} items in ${home}`);
    console.log("Try: momento search pricing");
    return;
  }

  if (command === "clear-demo") {
    console.log(`Removed ${clearDemo(home)} demo items.`);
    return;
  }

  if (command === "stats") {
    const stats = statsVault(home);
    console.log(`${stats.counts.all} unique items`);
    console.log(`${stats.counts.bookmark} bookmarks · ${stats.counts.heart} hearts · ${stats.counts.shared} shared`);
    if (stats.newest) console.log(`${stats.oldest} → ${stats.newest}`);
    console.log(home);
    return;
  }

  if (command === "deep-setup") {
    console.log(deepSetupMessage(home));
    return;
  }

  if (command === "repair-order") {
    if (!args.source || args.source === "all") {
      throw new Error("Usage: momento repair-order --source bookmark|heart|shared");
    }
    const result = repairLegacySourceOrder(home, args.source);
    console.log(`Repaired ${result.repaired} ${args.source} memories.`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
    return;
  }

  if (command === "search") {
    const query = args._.slice(1).join(" ").trim();
    if (!query) throw new Error("Usage: momento search <query>");
    const options = {
      source: args.source || "all",
      limit: Number(args.limit || 50),
      collection: args.collection,
      rerank: Boolean(args.rerank),
    };
    const hits = args.deep
      ? await deepSearchVault(home, query, options)
      : searchVault(home, query, options);
    printHits(hits);
    return;
  }

  if (command === "ask") {
    const question = args._.slice(1).join(" ").trim();
    if (!question) throw new Error("Usage: momento ask <question>");
    const options = {
      source: args.source || "all",
      limit: Number(args.limit || 8),
      collection: args.collection,
      rerank: Boolean(args.rerank),
    };
    let hits;
    try {
      hits = await deepSearchVault(home, question, options);
      console.error(`Evidence: ${hits.length} memories via QMD hybrid search`);
    } catch (error) {
      if (args.deep) throw error;
      hits = searchVault(home, question, options).slice(0, options.limit);
      console.error("QMD index unavailable; using keyword evidence.");
      console.error(`Evidence: ${hits.length} memories`);
    }
    await answerWithLocalModel(question, hits, {
      model: args.model,
      maxTokens: 420,
    });
    return;
  }

  if (command === "serve") {
    const port = Number(args.port || process.env.MOMENTO_PORT || 4177);
    return startServer(home, port, args.token || process.env.MOMENTO_TOKEN || "");
  }

  if (command === "phone") {
    const port = Number(args.port || process.env.MOMENTO_PORT || 4177);
    await ensureServer(home, port);
    const phoneToken = await createPhoneSession(port);
    return startTunnel(port, phoneToken);
  }

  throw new Error(`Unknown command: ${command}`);
}

function startServer(home, port, token) {
  const server = createServer({ home, token });
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Momento may already be running.`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, "0.0.0.0", () => printServerReady(home, port));
}

async function ensureServer(home, port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (response.ok) return;
  } catch {
    // start below
  }
  const server = createServer({ home });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  printServerReady(home, port);
}

async function createPhoneSession(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/phone-session`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Restart `momento serve` to enable secure phone pairing.");
  }
  const data = await response.json();
  if (!data.token) throw new Error("Could not create a phone pairing token.");
  return data.token;
}

function startTunnel(port, phoneToken) {
  console.log("\nCreating secure phone URL…");
  const child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  let announced = false;
  const handle = (chunk) => {
    const text = chunk.toString();
    const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
    if (url && !announced) {
      announced = true;
      const pairedUrl = `${url}/?token=${encodeURIComponent(phoneToken)}`;
      console.log(`\nOpen this paired link on your phone:\n\n  ${pairedUrl}\n`);
      console.log("Only this paired link can read your archive through the tunnel.");
      console.log("Keep this terminal open. Press Ctrl+C when finished.");
    }
  };
  child.stdout.on("data", handle);
  child.stderr.on("data", handle);
  child.on("error", () => {
    console.error("cloudflared is required. Install with: brew install cloudflared");
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code || 0));
}

function printServerReady(home, port) {
  console.log(`Momento is ready: http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`Phone on this Wi-Fi: http://${ip}:${port}`);
  console.log(`Vault: ${home}`);
  console.log("For a secure phone URL: momento phone");
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function printHits(hits) {
  if (hits.length === 0) {
    console.log("No matches.");
    return;
  }
  for (const item of hits) {
    const sources = item.sources.map((source) => sourceLabel(source)).join(" + ");
    console.log(`\n${dateLabel(item.postedAt)} · @${item.author.handle} · ${sources}`);
    console.log(`  ${item.text.replace(/\s+/g, " ").slice(0, 180)}`);
    console.log(`  ${item.url}`);
  }
  console.log(`\n${hits.length} match${hits.length === 1 ? "" : "es"}`);
}

function sourceLabel(source) {
  return source === "heart" ? "Heart" : source === "bookmark" ? "Bookmark" : "Shared";
}

function dateLabel(value) {
  return value ? String(value).slice(0, 10) : "Unknown date";
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
