import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchItems } from "../src/search.js";
import { ingestItems, loadItems } from "../src/store.js";

function vault() {
  return mkdtempSync(join(tmpdir(), "momento-test-"));
}

const base = {
  id: "123",
  text: "A useful thread about usage based pricing",
  url: "https://x.com/example/status/123",
  postedAt: "2026-01-01T12:00:00Z",
  author: { handle: "example", displayName: "Example" },
};

test("merges heart and bookmark into one memory", () => {
  const home = vault();
  ingestItems(home, [{ ...base, source: "heart" }]);
  ingestItems(home, [{ ...base, source: "bookmark" }]);
  const items = loadItems(home);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.sort(), ["bookmark", "heart"]);
  const markdown = readFileSync(join(home, "by-id", "2026-01-01-example-123.md"), "utf8");
  assert.match(markdown, /sources: \["heart", "bookmark"\]/);
});

test("real sync removes demo memories", () => {
  const home = vault();
  ingestItems(home, [{ ...base, id: "demo", demo: true, source: "heart" }], { removeDemo: false });
  ingestItems(home, [{ ...base, id: "real", source: "bookmark" }]);
  assert.deepEqual(loadItems(home).map((item) => item.id), ["real"]);
});

test("natural query ignores filler words", () => {
  const results = searchItems(
    [{ ...base, sources: ["bookmark"], savedAt: base.postedAt }],
    "that tweet I saved about pricing",
  );
  assert.equal(results.length, 1);
});

test("source filter preserves intent", () => {
  const items = [
    { ...base, id: "a", sources: ["heart"], savedAt: base.postedAt },
    { ...base, id: "b", sources: ["bookmark"], savedAt: base.postedAt },
  ];
  assert.deepEqual(searchItems(items, "pricing", { source: "heart" }).map((item) => item.id), ["a"]);
});
