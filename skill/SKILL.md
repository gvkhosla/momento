---
name: momento
description: Search the user's local X/Twitter memory of Hearts, Bookmarks, and directly shared tweets. Use when they ask to find, recall, or reference something they liked, hearted, bookmarked, faved, or saved on X.
---

# Momento

Momento keeps X Hearts, Bookmarks, and Shared tweets as a merged local archive.

## Commands

```bash
momento path
momento stats
momento search "query"
momento search "query" --source bookmark
momento search "query" --source heart
```

The canonical archive is `$MOMENTO_HOME/items.json` (default `~/momento-vault/items.json`). Agent-readable markdown is in `~/momento-vault/by-id/*.md`.

## Workflow

1. Run `momento stats` to confirm the archive exists.
2. Search with the user's remembered phrase, person, or idea.
3. Use `--source bookmark` or `--source heart` only when their wording signals intent.
4. Quote the matching tweet and include its X URL.
5. If results are stale, ask the user to open the extension and sync.

## Source semantics

- `bookmark`: intentionally saved to return to
- `heart`: appreciated or endorsed
- `shared`: sent directly to Momento from phone/web

One tweet may have multiple sources without being duplicated.
