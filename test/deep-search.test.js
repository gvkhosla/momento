import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildAnswerPrompt,
  extractLlamaAnswer,
  formatGroundedAnswer,
} from "../src/answer.js";
import { deepSearchVault, deepSetupMessage } from "../src/deep-search.js";
import { ingestItems } from "../src/store.js";

const item = {
  id: "123",
  text: "Usage-based pricing works when the meter is obvious.",
  url: "https://x.com/example/status/123",
  postedAt: "2026-01-01T00:00:00Z",
  sources: ["bookmark"],
  author: { handle: "example" },
};

test("answer prompt requires grounded citations", () => {
  const prompt = buildAnswerPrompt("What did I save about pricing?", [item]);
  assert.match(prompt, /using only the evidence/i);
  assert.match(prompt, /\[1\] @example/);
  assert.match(prompt, /never invent facts/i);
  assert.match(prompt, /https:\/\/x\.com\/example\/status\/123/);
});

test("deep setup is explicit and never silently indexes", () => {
  const message = deepSetupMessage("/tmp/momento-vault");
  assert.match(message, /qmd collection add/);
  assert.match(message, /qmd embed/);
  assert.match(message, /manually managed QMD index/);
});

test("deep search maps QMD files back to Momento records", async () => {
  const home = mkdtempSync(join(tmpdir(), "momento-deep-"));
  ingestItems(home, [item]);
  const fakeQmd = join(home, "fake-qmd");
  writeFileSync(
    fakeQmd,
    `#!/bin/sh\nprintf '%s\\n' '[{"score":0.91,"file":"qmd://momento/2026-01-01-example-123.md","snippet":"pricing"}]'\n`,
  );
  chmodSync(fakeQmd, 0o755);
  const previous = process.env.MOMENTO_QMD_BIN;
  process.env.MOMENTO_QMD_BIN = fakeQmd;
  try {
    const results = await deepSearchVault(home, "pricing", { limit: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].retrieval, "qmd");
    assert.equal(results[0].score, 0.91);
  } finally {
    if (previous === undefined) delete process.env.MOMENTO_QMD_BIN;
    else process.env.MOMENTO_QMD_BIN = previous;
  }
});

test("grounded answers rebuild exact cited source URLs", () => {
  const second = { ...item, id: "456", url: "https://x.com/example/status/456" };
  const answer = formatGroundedAnswer(
    "A pattern appears in both posts [2] and [1].\n\nSources:\nbroken",
    [item, second],
  );
  assert.match(answer, /\[1\] https:\/\/x\.com\/example\/status\/123/);
  assert.match(answer, /\[2\] https:\/\/x\.com\/example\/status\/456/);
  assert.doesNotMatch(answer, /broken/);
});

test("llama output strips banners and echoed evidence", () => {
  const output = `Loading model...\n<MOMENTO_ANSWER>Useful answer [1].\n\n[ Prompt: 20 t/s | Generation: 10 t/s ]\n\nExiting...`;
  assert.equal(extractLlamaAnswer(output), "Useful answer [1].");
  const truncated = `Loading model...\n> Evidence line... (truncated)\nGrounded answer [1].\n\n[ Prompt: 20 t/s ]`;
  assert.equal(extractLlamaAnswer(truncated), "Grounded answer [1].");
});
