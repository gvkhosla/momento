import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBrief, loadBrief } from "../src/brief.js";
import { saveSettings } from "../src/config.js";
import { captureUrl, firstUrl } from "../src/capture.js";
import { extractUrl, pickExtractUrl } from "../src/extract.js";
import { enrichVault } from "../src/enrich.js";
import { readableText } from "../src/html.js";
import { renderBriefEmail, sendBriefEmail } from "../src/mail.js";
import { shouldSendBrief } from "../src/scheduler.js";
import { ingestItems, loadItems } from "../src/store.js";

test("article extraction prefers article body over chrome", () => {
  const html = `
    <html><head><meta property="og:title" content="Usage pricing"><title>Ignore</title></head>
    <body>
      <nav>Sign in</nav>
      <article><p>Usage-based pricing only works when the meter is obvious to the buyer.</p></article>
      <footer>Subscribe</footer>
    </body></html>`;
  assert.match(readableText(html), /meter is obvious/);
  assert.doesNotMatch(readableText(html), /Subscribe/);
});

test("firstUrl pulls a link out of shared text", () => {
  assert.equal(firstUrl("read this https://example.com/post tonight"), "https://example.com/post");
  assert.equal(firstUrl("example.com/post"), "https://example.com/post");
});

test("captureUrl accepts a normal article URL", async () => {
  const home = mkdtempSync(join(tmpdir(), "momento-capture-"));
  const html = `<html><head><meta property="og:title" content="A useful post"></head>
    <body><article><p>This article explains usage-based pricing in plain language for operators who ship weekly.</p></article></body></html>`;
  const result = await captureUrl(home, "https://example.com/post", "bookmark", {
    index: false,
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
  });
  assert.equal(result.inserted, 1);
  assert.equal(loadItems(home)[0].extraction?.title, "A useful post");
  assert.match(result.item.text, /usage-based pricing/);
});

test("pickExtractUrl ignores tweet permalinks and uses the outbound link", () => {
  const url = pickExtractUrl({
    text: "see this https://t.co/abc",
    url: "https://x.com/example/status/1",
    links: [{ url: "https://t.co/abc", expandedUrl: "https://simonwillison.net/2026/jan/1/agents/" }],
  });
  assert.equal(url, "https://simonwillison.net/2026/jan/1/agents/");
});

test("extractUrl reads title, canonical, and article text", async () => {
  const html = `<!doctype html><html><head>
    <title>Ignore tab</title>
    <meta property="og:title" content="Junior">
    <meta property="og:site_name" content="GitHub">
    <link rel="canonical" href="https://github.com/getsentry/junior">
  </head><body><article><p>Junior is an unreliable but promising coding agent.</p></article></body></html>`;
  const result = await extractUrl("https://example.com/junior", {
    fetchImpl: async () =>
      new Response(html, { headers: { "content-type": "text/html" }, url: "https://example.com/junior" }),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.title, "Junior");
  assert.match(result.text, /coding agent/);
});

test("enrichment stores extracted article on the bookmark", async () => {
  const home = mkdtempSync(join(tmpdir(), "momento-enrich-"));
  ingestItems(home, [
    {
      id: "99",
      text: "worth reading https://t.co/x",
      url: "https://x.com/example/status/99",
      source: "bookmark",
      author: { handle: "example", displayName: "Example" },
      links: [{ url: "https://t.co/x", expandedUrl: "https://example.com/post" }],
    },
  ]);
  const html = `<html><head><meta property="og:title" content="A useful post"></head>
    <body><article><p>This article explains usage-based pricing in plain language for operators.</p></article></body></html>`;
  const result = await enrichVault(home, {
    index: false,
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
  });
  assert.equal(result.ready, 1);
  const item = loadItems(home)[0];
  assert.equal(item.extraction.status, "ready");
  assert.equal(item.extraction.title, "A useful post");
  assert.match(item.extraction.text, /usage-based pricing/);
});

test("brief falls back without a local model and writes the vault file", async () => {
  const home = mkdtempSync(join(tmpdir(), "momento-brief-"));
  ingestItems(home, [
    {
      id: "1",
      text: "Usage-based pricing only works when the meter is obvious.",
      url: "https://x.com/lenny/status/1",
      source: "bookmark",
      bookmarkedAt: new Date().toISOString(),
      author: { handle: "lenny", displayName: "Lenny" },
      extraction: {
        status: "ready",
        title: "Obvious meters",
        site: "lenny",
        excerpt: "Usage-based pricing only works when the meter is obvious.",
        text: "Usage-based pricing only works when the meter is obvious.",
        url: "https://example.com/pricing",
      },
    },
  ]);
  const brief = await buildBrief(home, { skipModel: true, lookbackHours: 36 });
  assert.ok(brief.headline);
  assert.equal(brief.recents.length, 1);
  assert.equal(loadBrief(home, brief.date).headline, brief.headline);
  assert.match(renderBriefEmail(brief), /Obvious meters/);
});

test("Resend SDK send uses the official emails.send payload", async () => {
  const home = mkdtempSync(join(tmpdir(), "momento-mail-"));
  saveSettings(home, { email: "geetkhosla@gmail.com" });
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  const calls = [];
  try {
    const sent = await sendBriefEmail(
      home,
      {
        headline: "Hello World",
        date: "2026-08-15",
        summary: "Congrats on sending your first email.",
        insights: [],
        recents: [],
        podcastScript: "",
      },
      {
        resend: {
          emails: {
            send: async (payload) => {
              calls.push(payload);
              return { data: { id: "email_1" }, error: null };
            },
          },
        },
      },
    );
    assert.equal(sent.to, "geetkhosla@gmail.com");
    assert.equal(calls[0].from, "Momento <onboarding@resend.dev>");
    assert.deepEqual(calls[0].to, ["geetkhosla@gmail.com"]);
    assert.match(calls[0].html, /Hello World/);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test("scheduler waits until the configured local hour", () => {
  const home = mkdtempSync(join(tmpdir(), "momento-sched-"));
  const settings = saveSettings(home, { briefHour: 7, briefMinute: 0, timezone: "UTC" });
  assert.equal(shouldSendBrief(home, settings, new Date("2026-08-15T06:00:00.000Z")), false);
  assert.equal(shouldSendBrief(home, settings, new Date("2026-08-15T07:05:00.000Z")), true);
});
