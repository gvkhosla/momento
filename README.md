# liked

> Your X likes, as plain files your agent can search.

You heart tweets as a bookmark system. Months later you can't find them.
Obsidian sync + X API + cron is overkill when you need this once in a while.

**liked** dumps your likes into a local folder of markdown. Your agent (or `rg`) already knows how to search files.

```bash
liked serve
# load the Chrome extension → Sync likes
liked search "react compiler"
```

No database. No hosted app. No accounts. Likes stay on your machine.

## Install

Needs Node 20+ and a Chromium browser (Chrome/Arc/Brave/Edge).

```bash
git clone https://github.com/gvkhosla/liked.git
cd liked
npm link
liked serve
```

Leave that terminal running.

### Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder in this repo
4. Stay signed in to [x.com](https://x.com)
5. Click the **liked** extension icon → **Sync likes**

If capture fails: open `https://x.com/YOUR_HANDLE/likes`, let it load, hit Sync again.

### Search

```bash
liked search "pricing"
liked stats
liked path          # default: ~/liked-vault
liked open          # open vault in Finder
```

Optional demo data (no X needed):

```bash
liked seed
liked search pricing
```

## What you get

Each like becomes one markdown file in `~/liked-vault/by-id/`:

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

Point Obsidian at `~/liked-vault` if you want. Or don't — any agent that can read files works.

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
| `LIKED_HOME` / `--home` | `~/liked-vault` | Where files go |
| `LIKED_PORT` / `--port` | `4177` | Local server port |

## Not this

- Not a full bookmark reader ([bookmarx](https://github.com/vignesh07/bookmarx) is that, for bookmarks)
- Not a cloud sync service
- Not continuous background magic — open the popup when you care

## License

MIT
