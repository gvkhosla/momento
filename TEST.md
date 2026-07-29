# Test Momento v0.3

## Core app

```bash
cd ~/momento
npm link
momento seed
momento serve
```

Open http://localhost:4177 and verify:

- Four demo memories appear
- Counts: 4 unique, 2 Bookmarks, 2 Hearts, 1 Shared
- Empty timelines show newest save activity first
- Search `that tweet about pricing` returns Paul Graham and Lenny
- Filters preserve Heart versus Bookmark
- Add a link opens and closes correctly

## Extension sync

1. `chrome://extensions` → Developer mode
2. Reload the existing Momento extension (v0.3.0), or remove the old copy
3. Load unpacked: `/Users/geetkhosla/momento/extension`
4. Stay signed in at x.com
5. Open Momento → choose Bookmarks + Hearts → Sync selected

The first real batch automatically removes demo memories.

If capture fails, visit these pages once and retry:

- `https://x.com/i/bookmarks`
- `https://x.com/YOUR_HANDLE/likes`

## Phone

```bash
momento phone
```

Open the printed HTTPS URL on your phone. Test search, source filters, Add a link, and Add to Home Screen.

## Deep search and local answers

Momento only prints setup commands; run them manually when you want to opt in:

```bash
momento deep-setup
momento search "usage pricing" --deep
```

With `llama-cli` and a GGUF instruct model:

```bash
MOMENTO_MODEL=~/models/model.gguf momento ask "What did I save about pricing?"
```

Answers must cite the retrieved X URLs and admit when evidence is insufficient.

## Automated checks

```bash
npm test
npm run check
curl http://127.0.0.1:4177/api/health
```
