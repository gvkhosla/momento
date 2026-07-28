# momento

> Your X likes, written down before you forget.

![momento — polaroids on a wall. REMEMBER. the heart is not a filing system.](./assets/momento.png)

<p align="center"><sub>Like the film: you won't remember. Write it down.<br/>Not affiliated with <i>Memento</i> (2000) — just stealing the bit about external memory.</sub></p>

You heart tweets as a bookmark system. Months later they're gone.
Obsidian sync + X API + cron is overkill when you need this once in a while.

**momento** dumps your likes into a local folder of markdown. Your agent (or `rg`) already knows how to search files.

```bash
momento serve
# load the Chrome extension → Sync likes
momento search "react compiler"
```

No database. No hosted app. No accounts. Likes stay on your machine.

## Install

Needs Node 20+ and a Chromium browser (Chrome/Arc/Brave/Edge).

```bash
git clone https://github.com/gvkhosla/momento.git
cd momento
npm link
momento serve
```

Leave that terminal running.

### Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder in this repo
4. Stay signed in to [x.com](https://x.com)
5. Click the **momento** extension icon → **Sync likes**

If capture fails: open `https://x.com/YOUR_HANDLE/likes`, let it load, hit Sync again.

### Search

```bash
momento search "pricing"
momento stats
momento path          # default: ~/momento-vault
momento open          # open vault in Finder
```

Optional demo data (no X needed):

```bash
momento seed
momento search pricing
```

## What you get

Each like becomes one markdown file in `~/momento-vault/by-id/` — a polaroid for your agent:

```markdown
---
id: "1900123456789012345"
url: https://x.com/paulg/status/1900123456789012345
author: "@paulg"
author_name: Paul Graham
date: 2025-03-12T14:22:00.000Z
liked_at: 2026-07-28T08:30:00.000Z
---

The best founders are relentlessly resourceful.
```

Also: `likes.jsonl` for bulk tooling.

Point Obsidian at `~/momento-vault` if you want. Or don't — any agent that can read files works.

## Agent skill

Drop [`skill/SKILL.md`](./skill/SKILL.md) into your agent skills dir. Then ask:

> find that tweet I liked about usage-based pricing

## How sync works

1. Extension sniffs X's live `Likes` GraphQL config from your session
2. Paginates likes with your browser cookies (no X developer account)
3. POSTs batches to `http://127.0.0.1:4177`
4. Server writes markdown. Idempotent on tweet id.

## Config

| Env / flag | Default | Meaning |
|---|---|---|
| `MOMENTO_HOME` / `--home` | `~/momento-vault` | Where files go |
| `MOMENTO_PORT` / `--port` | `4177` | Local server port |

## Not this

- Not a full bookmark reader ([bookmarx](https://github.com/vignesh07/bookmarx) is that, for bookmarks)
- Not a cloud sync service
- Not continuous background magic — open the popup when you care
- Not medical advice for anterograde amnesia

## License

MIT
