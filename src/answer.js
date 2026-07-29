import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export function buildAnswerPrompt(question, items) {
  const evidence = items
    .map((item, index) => {
      const sources = (item.sources || []).join(", ");
      const fullText = String(item.text || "").trim();
      const text = fullText.length > 1_600 ? `${fullText.slice(0, 1_600)}…` : fullText;
      return `[${index + 1}] @${item.author?.handle || "unknown"} · ${String(item.postedAt || "").slice(0, 10)} · ${sources}\n${text}\n${item.url}`;
    })
    .join("\n\n");

  return `You are Momento, an answer engine over one person's saved X posts.
Answer the question using only the evidence below.
If the evidence is insufficient, say so plainly; never invent facts.
Be concise: use at most eight sentences before the Sources line.
Synthesize patterns instead of listing every post.
Cite factual claims with source numbers like [1] or [2].
End with a short "Sources" line containing the cited X URLs.

Question: ${question}

Evidence:
${evidence}

<MOMENTO_ANSWER>`;
}

export function findLocalModel(explicitPath) {
  const configured = explicitPath || process.env.MOMENTO_MODEL;
  if (configured) {
    const path = resolve(configured.replace(/^~(?=\/|$)/, homedir()));
    if (!existsSync(path)) throw new Error(`Local model not found: ${path}`);
    return path;
  }

  const modelDir = join(homedir(), "models");
  if (!existsSync(modelDir)) return null;
  const candidates = readdirSync(modelDir)
    .filter((name) => name.toLowerCase().endsWith(".gguf"))
    .map((name) => ({ path: join(modelDir, name), size: statSync(join(modelDir, name)).size }))
    .sort((a, b) => a.size - b.size);
  return candidates[0]?.path || null;
}

export async function answerWithLocalModel(question, items, options = {}) {
  const { answer } = await generateLocalAnswer(question, items, {
    ...options,
    onStart: ({ model }) => {
      console.error(`Local model: ${model}`);
      console.error("Thinking locally…");
      options.onStart?.({ model });
    },
  });
  process.stdout.write(`${answer}\n`);
}

export async function generateLocalAnswer(question, items, options = {}) {
  if (!items.length) throw new Error("No evidence matched that question.");
  const model = findLocalModel(options.model);
  if (!model) {
    throw new Error(
      "No local GGUF model found. Set MOMENTO_MODEL=/path/to/model.gguf or place an instruct model in ~/models.",
    );
  }

  const prompt = buildAnswerPrompt(question, items);
  const binary = process.env.MOMENTO_LLAMA_CLI || "llama-cli";
  const args = [
    "-m",
    model,
    "--ctx-size",
    "8192",
    "--predict",
    String(options.maxTokens || 420),
    "--temp",
    "0.2",
    "--top-p",
    "0.9",
    "--simple-io",
    "--single-turn",
    "--log-disable",
    "-p",
    prompt,
  ];

  options.onStart?.({ model });
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error("llama-cli is required. Install it with: brew install llama.cpp"));
      } else {
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `Local model exited with code ${code}.`));
    });
  });
  const answer = extractLlamaAnswer(output);
  if (/^(error:|failed\b)|exceeds the available context size/i.test(answer)) {
    throw new Error(answer.split("\n")[0]);
  }
  return { answer: formatGroundedAnswer(answer, items), model };
}

export function formatGroundedAnswer(answer, items) {
  const body = answer.replace(/\n+Sources:\s*[\s\S]*$/i, "").trim();
  const citedIndexes = [...answer.matchAll(/\[(\d+)\]/g)]
    .map((match) => Number(match[1]) - 1)
    .filter((index) => index >= 0 && index < items.length);
  const uniqueIndexes = [...new Set(citedIndexes)];
  const sourceIndexes = uniqueIndexes.length > 0 ? uniqueIndexes : items.map((_, index) => index);
  const sources = sourceIndexes
    .map((index) => `[${index + 1}] ${items[index].url}`)
    .join("\n");
  return `${body}\n\nSources:\n${sources}`;
}

export function extractLlamaAnswer(output) {
  const marker = "<MOMENTO_ANSWER>";
  const markerIndex = output.lastIndexOf(marker);
  const truncatedIndex = output.lastIndexOf("(truncated)");
  const answer = markerIndex >= 0
    ? output.slice(markerIndex + marker.length)
    : truncatedIndex >= 0
      ? output.slice(truncatedIndex + "(truncated)".length)
      : output;
  return answer
    .replace(/\n\[ Prompt:[\s\S]*$/m, "")
    .replace(/\n+Exiting\.\.\.\s*$/m, "")
    .trim();
}
