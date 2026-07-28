---
name: momento
description: Search the user's X/Twitter likes vault (local markdown from the momento CLI). Use when they ask about something they liked, faved, or hearted on X/Twitter.
---

# momento

The user keeps X likes as local markdown via the `momento` CLI.

## Vault

```bash
momento path          # print vault dir (default ~/momento-vault)
momento stats
momento search "query"
```

Files live in `$MOMENTO_HOME/by-id/*.md` with YAML frontmatter (`id`, `url`, `author`, `date`, `liked_at`) and tweet body.

## Workflow

1. Run `momento stats` — if empty, tell them to run `momento serve` and Sync from the extension.
2. Search with `momento search "<keywords>"` or `rg -i "..." "$(momento path)/by-id"`.
3. Open matching `.md` files for full text + URL.
4. Prefer quote + link over paraphrasing when answering "what did I like about X".

## Notes

- Likes are not bookmarks. This vault is hearts only.
- Sync is manual (extension popup). Stale vault ⇒ ask them to re-sync.
