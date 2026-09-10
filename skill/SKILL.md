---
name: momento
description: Search the user's local X bookmark archive, including extracted articles, and work with the daily brief. Use when they ask to find, recall, or brief something they bookmarked or saved on X.
---

# Momento

Momento watches X Bookmarks, extracts the linked article, indexes it, and writes a daily brief. Hearts may still be stored, but briefs and default search are bookmark-only.

## Commands

```bash
momento path
momento stats
momento search "query" --source bookmark
momento search "half-remembered idea" --deep
momento ask "What patterns did I bookmark about this?"
momento enrich
momento brief
momento brief --send
```

The canonical archive is `$MOMENTO_HOME/items.json` (default `~/momento-vault/items.json`). Agent-readable markdown is in `~/momento-vault/by-id/*.md`. Daily briefs live in `~/momento-vault/briefs/`.

## Workflow

1. Run `momento stats` to confirm the archive exists.
2. Search bookmarks first. Include extracted titles and article text.
3. Use `--deep` for conceptual recall once the QMD index exists.
4. Use `momento ask` only when synthesis is requested; preserve its numbered citations.
5. For "what should I read" or "what did I save yesterday", open or generate `momento brief`.
6. Quote the matching bookmark, the extracted article title when present, and the X URL.
7. If results are stale, ask the user to keep `momento serve` running and the extension signed in.

## Source semantics

- `bookmark`: intentionally saved; this is the product surface
- `heart`: still stored if synced, not used for briefs
- `shared`: sent directly to Momento from phone/web
