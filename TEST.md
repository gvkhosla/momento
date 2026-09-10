# Test Momento v0.4

## Core app

```bash
cd ~/momento
npm link
momento seed
momento serve
```

Open http://localhost:4177 and verify:

- Home is **Today**, not the search box
- Four demo memories can still be searched
- Counts include Bookmarks first
- Search `that tweet about pricing` returns Paul Graham and Lenny
- Filters still expose Hearts if you want them
- Add a link opens and closes correctly
- Daily settings accept an email and hour

## Extension sync

1. `chrome://extensions` → Developer mode
2. Reload the existing Momento extension (v0.4.0), or remove the old copy
3. Load unpacked: `/Users/geetkhosla/momento/extension`
4. Stay signed in at x.com
5. Open Momento → leave Bookmarks checked → Sync selected

The first real batch automatically removes demo memories. After bookmarks have completed once, leave the browser and local server running and verify the hourly alarm performs an incremental refresh without reopening the popup.

If capture fails, visit this page once and retry:

- `https://x.com/i/bookmarks`

## Extraction and daily brief

```bash
momento enrich --limit 10
momento brief --skip-model
```

Confirm `~/momento-vault/briefs/` contains today's markdown. In the app, **Today** should show the headline and new bookmarks. **Email me this** requires `RESEND_API_KEY` plus `momento configure --email`.

Optional spoken version:

```bash
momento brief --skip-model --speak /tmp/momento.m4a
```

## Phone

```bash
momento phone
```

Open the printed HTTPS URL on your phone. Test the brief, search, Add a link, and Add to Home Screen.

## Deep search and local answers

```bash
momento index
momento search "usage pricing" --deep
```

With `llama-cli` and a GGUF instruct model:

```bash
MOMENTO_MODEL=~/models/model.gguf momento ask "What did I bookmark about pricing?"
```

In the web app, verify **Search** and **Ask**. Search should show extracted titles when present. Ask should show a local synthesis followed by numbered reference cards.

## Automated checks

```bash
npm test
npm run check
curl http://127.0.0.1:4177/api/health
curl http://127.0.0.1:4177/api/brief
```
