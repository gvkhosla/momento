# Momento web

The mobile PWA is a statically exported Next.js 16 app built from the shadcn preset requested for Momento:

```bash
bunx --bun shadcn@latest init --preset b3Zheoix4U --template next
```

Preset details:

- `base-sera`
- Stone base palette
- Base UI primitives
- Phosphor icons
- Oxanium UI type + Geist headings

## Develop

Run the root archive API first:

```bash
momento serve
```

Then:

```bash
cd web
bun run dev
```

Next development rewrites `/api/*` to `127.0.0.1:4177/api/*`.

## Build

```bash
bun run build
```

The static export is written to `web/out` and intentionally committed. The zero-dependency Momento CLI serves this export directly, so users do not need the Next toolchain after cloning.
