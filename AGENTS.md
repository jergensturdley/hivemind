# Hivemind

Same project notes as `CLAUDE.md`. This file exists so Grok, Codex, Cursor, and OpenCode pick up the repo without a Claude-specific filename.

- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`

Harness registry: `src/lib/harnesses.ts`. Ship writes a multi-harness pack so the *output* of a mission is also portable across those CLIs.
