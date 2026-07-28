---
name: liked
description: Search the user's X/Twitter likes vault (local markdown from the liked CLI). Use when they ask about something they liked, faved, or hearted on X/Twitter.
---

# liked

The user keeps X likes as local markdown via the `liked` CLI.

## Vault

```bash
liked path          # print vault dir (default ~/liked-vault)
liked stats
liked search "query"
```

Files live in `$LIKED_HOME/by-id/*.md` with YAML frontmatter (`id`, `url`, `author`, `date`, `liked_at`) and tweet body.

## Workflow

1. Run `liked stats` — if empty, tell them to run `liked serve` and Sync from the extension.
2. Search with `liked search "<keywords>"` or `rg -i "..." "$(liked path)/by-id"`.
3. Open matching `.md` files for full text + URL.
4. Prefer quote + link over paraphrasing when answering "what did I like about X".

## Notes

- Likes are not bookmarks. This vault is hearts only.
- Sync is manual (extension popup). Stale vault ⇒ ask them to re-sync.
