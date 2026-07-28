# Test momento (5 min)

## 1. Server (already can be running)

```bash
momento serve
```

Expect: `momento listening on http://127.0.0.1:4177`

## 2. Optional: demo search without X

```bash
momento seed
momento search pricing
momento stats
momento open
```

## 3. Real X likes

1. Chrome → `chrome://extensions` → Developer mode ON
2. **Load unpacked** → select:

   `/Users/geetkhosla/momento/extension`

3. Stay signed in at [x.com](https://x.com)
4. Click the **momento** extension icon → **Sync likes**
5. Wait for “Done…”

If capture fails: open `https://x.com/YOUR_HANDLE/likes`, let it load, sync again.

## 4. Search

```bash
momento search "a word you remember"
momento path          # ~/momento-vault
rg -i "word" "$(momento path)/by-id"
```

## 5. Agent

```text
search my momento tweets about pricing
```

(with `momento/skill/SKILL.md` installed, or just tell the agent the vault path)
