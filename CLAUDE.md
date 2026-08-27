# Hivemind

Multi-agent build swarm: a Next.js App Router app that plans, specs, and implements a product in a live group chat. Product name in `src/app/layout.tsx` is **Hivemind**; `package.json` is still named `nextjs-postgresql-template`.

## Tech stack

- TypeScript 5.9 (strict), Next.js 16, React 19
- Tailwind CSS 4 via `@tailwindcss/postcss`
- Drizzle ORM + `pg` (PostgreSQL)
- ESLint 9 + `eslint-config-next`

Path alias: `@/*` → `./src/*`.

## Commands

- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm run start`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Smoke (end-to-end, needs Postgres up): `npm run smoke`

No unit-test runner or CI is present; `scripts/smoke.py` is the regression harness.

Runtime needs `DATABASE_URL`. Postgres and the Next.js app both run as Apple `container`s (`hivemind-pg`, `hivemind-web`).

- Start DB: `npm run db:up`
- Stop DB: `npm run db:down`
- Push schema: `npm run db:push`
- Build + run the app container: `npm run app:up`
- Stop the app container: `npm run app:down`
- Both: `npm run up` / `npm run down`

Local `npm run dev` still works against the same Postgres. Copy `.env.example` to `.env`. Schema lives in `src/db/schema.ts`; kit config is `drizzle.config.json`. Image build is `Dockerfile` (`output: "standalone"`).

## Layout

| Path | Role |
|------|------|
| `src/app/` | App Router pages (`/`, `/studio`, `/settings`) |
| `src/app/api/` | REST route handlers (auth, projects, events, keys, settings, health) |
| `src/components/` | Studio UI (`Workbench`, `Terminal`, `useSwarm`) |
| `src/lib/engine.ts` | Stage machine / swarm orchestrator |
| `src/lib/session.ts` | HMAC session cookie (`hive_session`) |
| `src/lib/llm.ts` | BYOK chat streaming (OpenAI-compatible, Anthropic messages, Codex Responses) |
| `src/db/` | Drizzle client + schema |

API handlers typically set `export const runtime = "nodejs"` and return 401 `{ error: "unauthorized" }` when `getSessionUser()` is null.

## Harnesses

Coding-agent bridges live in `src/lib/harnesses.ts` (Claude Code, Grok, Cursor, Codex, Aider, Gemini, OpenCode, plus native). Ship writes a multi-harness pack (`HARNESS.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.cursor/rules/project.mdc`). Probe PATH via `GET /api/harnesses`. Switch a mission with `harness use <id>` in swarm-cli.

## Roadmap

`ROADMAP.md` tracks forward plans. The engine is live-only: there is no simulation fallback — failed or missing live calls halt the mission with the real error and point at the swarm-cli `doctor` command. Check it before adding stage-machine behavior.

## Conventions

- Components: PascalCase (`StudioClient.tsx`). Hooks: camelCase (`useSwarm.ts`).
- Server modules import `db` from `@/db` and tables from `@/db/schema`.
- Prefer existing App Router route files over adding a second HTTP stack.

## Safety notes

- `SESSION_SECRET` must be set — `src/lib/session.ts` throws at startup if it is missing. The dev value lives in `.env` / `scripts/app-up.sh`; override it for anything beyond local use.
- `api_keys.secret` is stored in Postgres. Treat it as credential material.
- `drizzle.config.json` has a local default URL (`postgres:postgres@127.0.0.1:5432/app_db`). Runtime still requires `DATABASE_URL`.
