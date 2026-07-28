# Test liked (5 min)

## 1. Server (already can be running)

```bash
liked serve
```

Expect: `liked listening on http://127.0.0.1:4177`

## 2. Optional: demo search without X

```bash
liked seed
liked search pricing
liked stats
liked open
```

## 3. Real X likes

1. Chrome → `chrome://extensions` → Developer mode ON
2. **Load unpacked** → select:

   `/Users/geetkhosla/liked/extension`

3. Stay signed in at [x.com](https://x.com)
4. Click the **liked** extension icon → **Sync likes**
5. Wait for “Done…”

If capture fails: open `https://x.com/YOUR_HANDLE/likes`, let it load, sync again.

## 4. Search

```bash
liked search "a word you remember"
liked path          # ~/liked-vault
rg -i "word" "$(liked path)/by-id"
```

## 5. Agent

```text
search my liked tweets about pricing
```

(with `liked/skill/SKILL.md` installed, or just tell the agent the vault path)
