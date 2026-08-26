/**
 * Simulation engine — deterministic, spec-aware content generation used when
 * no API key is configured (and for swarm banter even when one is).
 */

export type SwarmCtx = {
  product: string;
  slug: string;
  tagline: string;
  features: string[];
  stack: { frontend: string; backend: string; data: string; note: string };
  domain: string;
};

const FALLBACK_FEATURES = [
  "Accounts & authentication",
  "Core data model & CRUD",
  "Realtime activity feed",
  "Responsive dashboard",
  "Role-based permissions",
];

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 24) || "mission"
  );
}

function camel(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  if (!parts.length || !parts[0]) return "core";
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
      .join("")
  );
}

export function parseSpec(spec: string, fallbackName: string): SwarmCtx {
  const trimmed = spec.trim();

  // Product name: quoted string, or the first few words.
  const quoted = trimmed.match(/["“”«]([^"“”«»]{2,42})["“”»]/);
  let product: string;
  if (quoted) {
    product = titleCase(quoted[1]);
  } else {
    const firstLine = trimmed.split(/\n/)[0] ?? "";
    const words = firstLine
      .replace(/^(build|create|make|design|an?|i (want|need)|we (want|need)|please)+\s+/i, "")
      .split(/\s+/)
      .slice(0, 3)
      .filter((w) => /[a-zA-Z]/.test(w));
    product = words.length ? titleCase(words.join(" ").replace(/[.,;:]+$/, "")) : fallbackName;
  }
  if (product.length > 36) product = product.slice(0, 36).trim();

  // Features: bullet lists first, then clause splitting.
  const bullets = trimmed.match(/^\s*[-*•]\s+(.+)$/gm);
  let features: string[];
  if (bullets && bullets.length >= 2) {
    features = bullets
      .map((b) => b.replace(/^\s*[-*•]\s+/, "").replace(/\*\*/g, "").trim())
      .filter((f) => f.length > 3)
      .slice(0, 6);
  } else {
    const clauses = trimmed
      .replace(/\n+/g, ";")
      .split(/(?:;|,|\band\b(?= ))/i)
      .map((c) =>
        c
          .replace(/^(it (should|needs? to|must)|should|must|with|that|including|include|features?|supports?|users? can|we need|i want)\s+/i, "")
          .trim()
          .replace(/[.!?]+$/, "")
      )
      .filter((c) => c.split(/\s+/).length >= 2 && c.split(/\s+/).length <= 10)
      .map(titleCase);
    features = [...new Set(clauses)].slice(0, 6);
  }
  if (features.length < 2) features = FALLBACK_FEATURES.slice(0, 4);

  const lower = trimmed.toLowerCase();
  let stack = {
    frontend: "Next.js 16 + React 19 + Tailwind",
    backend: "Next.js API routes + tRPC-lite services",
    data: "PostgreSQL + Drizzle ORM",
    note: "server-rendered, typed end-to-end, zero client state library",
  };
  let domain = "productivity";
  if (/game|arcade|puzzle|platformer/.test(lower)) {
    stack = {
      frontend: "React 19 + canvas renderer",
      backend: "Next.js API routes (leaderboards, saves)",
      data: "PostgreSQL + Drizzle ORM",
      note: "60fps loop, input abstraction, deterministic state",
    };
    domain = "gaming";
  } else if (/shop|store|commerce|marketplace|checkout/.test(lower)) {
    stack = {
      frontend: "Next.js 16 + React 19 + Tailwind",
      backend: "Next.js API routes + Stripe webhook layer",
      data: "PostgreSQL + Drizzle ORM",
      note: "transactional checkout, idempotent webhooks",
    };
    domain = "commerce";
  } else if (/dashboard|analytic|metric|insight/.test(lower)) {
    domain = "analytics";
  }

  const taglineMatch = trimmed.match(/^[^.!?\n]{12,160}[.!?]?/);
  const tagline = taglineMatch ? taglineMatch[0].trim() : `${product} — built by the swarm.`;

  return { product, slug: slugify(product), tagline, features, stack, domain };
}

/* ------------------------------------------------------------------ */
/* Spec / plan generators                                              */
/* ------------------------------------------------------------------ */

export function genSpec(ctx: SwarmCtx, version: number, feedback?: string): string {
  const rows = ctx.features
    .map(
      (f, i) =>
        `| P${i} | **${f}** | ${i < 2 ? "Must" : i < 4 ? "Should" : "Could"} | ${featureNote(f)} |`
    )
    .join("\n");
  return `# ${ctx.product} — Product Spec v${version}

> **Owner:** Nova (Product) · **Status:** ${version === 1 ? "Draft" : "Revised"} · **Source:** single user prompt

## 1. Vision
${ctx.tagline}

The mission: take one paragraph of intent and ship a working, tested ${ctx.domain} application — no scope creep, no dead ends.

## 2. Problem
Teams lose days translating a product idea into an executable plan. ${ctx.product} collapses intake → spec → plan → build into a single continuous motion.

## 3. Capabilities
| # | Capability | Priority | Notes |
|---|-----------|----------|-------|
${rows}

## 4. Primary journey
1. **Arrive** — user lands, intent captured in one field.
2. **Configure** — the ${camel(ctx.features[0] ?? "core")} surface adapts to their input.
3. **Act** — the primary loop (${slugify(ctx.features[0] ?? "core action")}) completes in ≤ 3 interactions.
4. **Review** — outcome is visible, undoable, and shareable.

## 5. Non-goals (v1)
- Native mobile apps (responsive web only)
- Multi-tenant billing${version > 1 ? " — deferred per review" : ""}
- Anything not listed above

## 6. Success metrics
- Time-to-first-value **< 60s**
- Primary-loop completion rate **≥ 85%**
- Zero P0 issues at ship
${feedback ? `\n## 7. Revision notes\n> ${feedback}\n` : ""}`;
}

function featureNote(f: string): string {
  const l = f.toLowerCase();
  if (/auth|login|account/.test(l)) return "email + magic link, session cookie";
  if (/realtime|live|feed|chat/.test(l)) return "SSE stream, optimistic UI";
  if (/dash|analytic|metric/.test(l)) return "server-aggregated, cached 30s";
  if (/notif/.test(l)) return "in-app first, email later";
  if (/search/.test(l)) return "trigram index, debounced";
  if (/export|report/.test(l)) return "CSV + shareable link";
  return "typed service layer, covered by tests";
}

export function genArch(ctx: SwarmCtx): string {
  const modules = ctx.features.slice(0, 4).map(camel);
  const tree = [
    `${ctx.slug}/`,
    `├─ src/app/`,
    `│  ├─ page.tsx                # landing + primary loop`,
    ...modules.map((m) => `│  ├─ ${m}/page.tsx`),
    `│  └─ api/                    # typed JSON endpoints`,
    `├─ src/components/`,
    ...modules.slice(0, 3).map((m) => `│  ├─ ${pascal(m)}Panel.tsx`),
    `├─ src/lib/`,
    `│  ├─ db.ts                   # drizzle client`,
    ...modules.map((m) => `│  ├─ ${m}.service.ts`),
    `└─ src/test/                 # happy path + edge cases`,
  ].join("\n");
  return `# ${ctx.product} — Architecture v1

> **Owner:** Vector (Architecture) · **Principle:** boring tech, sharp edges

## Stack
| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | ${ctx.stack.frontend} | ${ctx.stack.note} |
| Backend | ${ctx.stack.backend} | colocated with UI, typed contracts |
| Data | ${ctx.stack.data} | relational fits ${ctx.domain}; migrations via drizzle-kit |

## System shape
\`\`\`
 browser ──HTTPS──▶ next.js edge ──▶ service layer ──▶ postgres
                        │                  │
                        └── SSE stream ◀───┘  (live updates)
\`\`\`

## Data model (core)
- \`users\` — identity & preferences
- \`${modules[0] ?? "core"}_items\` — the primary noun (${ctx.features[0] ?? "core records"})
- \`events\` — append-only activity log feeding the live surface

## File tree
\`\`\`
${tree}
\`\`\`

## Invariants
1. Every mutation goes through a service — no raw SQL in routes.
2. Every list view paginates from day one.
3. Every external call has a timeout and a fallback.
`;
}

export function genPlanTasks(ctx: SwarmCtx): { title: string; detail: string }[] {
  const t = (title: string, detail: string) => ({ title, detail });
  const base = [
    t("Scaffold schema & data layer", `Drizzle schema for ${ctx.product.toLowerCase()}: users, ${slugify(ctx.features[0] ?? "core")}, events. Push + seed script.`),
    t(`Build: ${ctx.features[0] ?? "Core loop"}`, `Typed service + API route + UI for "${ctx.features[0]}". Optimistic updates, empty states.`),
  ];
  ctx.features.slice(1, 3).forEach((f) =>
    base.push(t(`Build: ${f}`, `Service, endpoint and panel for "${f}". Reuse shared primitives; keep it keyboard-friendly.`))
  );
  base.push(
    t("Compose the primary surface", `Wire panels into the landing page; responsive grid; loading skeletons; error toasts.`),
    t("Edge cases & polish", `Rate-limit mutations, validate all inputs server-side, empty/error/loading states everywhere.`)
  );
  return base;
}

/* ------------------------------------------------------------------ */
/* Code generation (simulated implementation)                          */
/* ------------------------------------------------------------------ */

function pascal(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "Core";
}

export function genCodeForTask(
  taskTitle: string,
  taskIndex: number,
  ctx: SwarmCtx
): { path: string; content: string; summary: string } {
  const mods = ctx.features.map(camel);
  const m = mods[Math.max(0, Math.min(taskIndex - 1, mods.length - 1))] ?? "core";
  const P = pascal(m);

  if (taskIndex <= 0 || /scaffold|schema|data layer/i.test(taskTitle)) {
    return {
      path: "src/lib/db.ts",
      summary: "data layer + typed services",
      content: `import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/** ${ctx.product} — core schema */
export const ${m}Items = pgTable("${slugify(ctx.features[0] ?? "core")}_items", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  at: timestamp("at").defaultNow().notNull(),
});

export const db = drizzle(process.env.DATABASE_URL!);

export async function listItems(ownerId: string, limit = 50) {
  return db.select().from(${m}Items).where(undefined as never).limit(limit);
}
`,
    };
  }

  if (/compose|surface|landing|wire/i.test(taskTitle)) {
    return {
      path: `src/app/page.tsx`,
      summary: "primary surface composition",
      content: `import { ${mods.slice(0, 3).map(pascal).join(", ")} } from "@/components/panels";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">${ctx.product}</h1>
        <p className="mt-2 text-neutral-500">${ctx.tagline.slice(0, 90)}</p>
      </header>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <${pascal(mods[0] ?? "core")}Panel />
        <${pascal(mods[1] ?? "core")}Panel />
        <${pascal(mods[2] ?? "core")}Panel />
      </div>
    </main>
  );
}
`,
    };
  }

  if (/edge|polish|validation|rate/i.test(taskTitle)) {
    return {
      path: `src/lib/guards.ts`,
      summary: "server-side validation + rate limits",
      content: `/** Defense layer for ${ctx.product} — every mutation passes through here. */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function assertSafeTitle(input: unknown): string {
  if (typeof input !== "string") throw new Error("title must be a string");
  const t = input.trim().slice(0, 140);
  if (t.length < 2) throw new Error("title too short");
  return t;
}
`,
    };
  }

  return {
    path: `src/lib/${m}.service.ts`,
    summary: `"${ctx.features[Math.min(taskIndex - 1, ctx.features.length - 1)]}" service + route`,
    content: `import { db } from "@/lib/db";
import { assertSafeTitle, rateLimit } from "@/lib/guards";

/** ${P} — service for "${ctx.features[Math.min(taskIndex - 1, ctx.features.length - 1)] ?? m}" */
export async function create${P}(ownerId: string, raw: unknown) {
  if (!rateLimit(\`\${ownerId}:${m}\`)) throw new Error("rate_limited");
  const title = assertSafeTitle(raw);
  const [row] = await db
    .insert(undefined as never)
    .values({ ownerId, title, payload: {} })
    .returning();
  return row;
}

export async function list${P}(ownerId: string) {
  void ownerId;
  return db.select().from(undefined as never).limit(50);
}

export const api = {
  async POST(req: Request) {
    const body = await req.json().catch(() => null);
    if (!body?.title) return Response.json({ error: "invalid" }, { status: 400 });
    const item = await create${P}(body.ownerId ?? "anon", body.title);
    return Response.json({ ok: true, item });
  },
};
`,
  };
}

/* ------------------------------------------------------------------ */
/* Review / QA / ship                                                  */
/* ------------------------------------------------------------------ */

export function genReview(ctx: SwarmCtx, files: string[], foundIssue: boolean): string {
  const list = files.map((f) => `- \`${f}\` — read ✓`).join("\n");
  return `# Code Review — ${ctx.product}

> **Reviewer:** Sentinel · **Verdict:** ${foundIssue ? "CHANGES REQUESTED → resolved below" : "APPROVED"}

## Files reviewed
${list || "- (no files yet)"}

## Findings
${
  foundIssue
    ? `1. **[P1] \`${files[0] ?? "src/lib/db.ts"}\`** — mutation path lacked a rate-limit guard; a scripted client could flood inserts. → **Fix:** routed writes through \`rateLimit()\` and added server-side title validation. Verified ✅
2. **[P2]** Empty-state copy missing on first run — added skeleton + CTA. ✅`
    : `1. **[P2]** Consider index on \`events.at\` before traffic grows — noted for v1.1.
2. **[P3]** Toast dedupe — harmless, deferred.`
}

## Standards check
- Types: no \`any\` in new code ✅
- All inputs validated server-side ✅
- No secrets in client bundle ✅
`;
}

export function genChecklist(ctx: SwarmCtx): string {
  const checks = ctx.features
    .slice(0, 5)
    .map((f) => `- [ ] **${f}** — verify happy path + one edge case`)
    .join("\n");
  return `# QA Checklist — ${ctx.product}

> **QA:** Probe · **Method:** static review — nothing was executed

${checks}
- [ ] Empty states render without console errors
- [ ] Mutations are rate-limited and validated
- [ ] Responsive at 360px / 768px / 1440px
`;
}

export function genShipSummary(
  ctx: SwarmCtx,
  stats: { files: number; tasks: number; messages: number; ms: number }
): string {
  const mins = Math.max(1, Math.round(stats.ms / 60000));
  return `# 🚀 ${ctx.product} — Shipped

**Wall time:** ~${mins} min · **${stats.tasks} tasks** · **${stats.files} files** · **${stats.messages} messages**

## What was built
${ctx.features.slice(0, 5).map((f) => `- ✅ ${f}`).join("\n")}

## Artifacts
- Product spec — drafted and revised in this room
- Architecture & task plan — sequenced and executed
- Implementation files — in the Files tab (simulation-engine templates)
- Review + QA checklist — static review only; nothing was executed

## Harness pack
The Files tab now includes \`HARNESS.md\`, \`CLAUDE.md\`, \`AGENTS.md\`, \`GEMINI.md\`, \`CONVENTIONS.md\`, and \`.cursor/rules/project.mdc\` so Claude Code, Cursor, Grok, Gemini, Codex, Aider, and OpenCode can all continue this repo.

## Next moves (optional)
- Switch the execution bridge in the terminal: \`harness use grok\` (or \`claude-code\`, \`cursor\`, …)
- Wire a real provider key in **Settings** and re-run any stage with live models
- Ask the swarm to extend a feature — it will plan the delta and build it
`;
}

/* ------------------------------------------------------------------ */
/* Banter                                                              */
/* ------------------------------------------------------------------ */

export function critiqueConcerns(ctx: SwarmCtx): string[] {
  const f0 = ctx.features[0] ?? "the core loop";
  return [
    `Two things before we approve. **1)** "${f0}" takes untrusted input — I want server-side validation and a rate limit on every mutation, not client-side politeness. **2)** The events table will grow unbounded; we should paginate from day one and add an index on \`at\` before launch.`,
    `Adding to Sentinel's point: if "${ctx.features[1] ?? "the secondary surface"}" reads from the same table, isolate the queries behind the service layer so we can cache later without touching UI code.`,
  ];
}

export function approvalAsk(ctx: SwarmCtx, tasks: number): string {
  return `Plan is stable after critique: **${tasks} tasks**, spec v2, architecture locked. Commander — approve the build and Forge starts immediately, or reply with changes.`;
}

export function interruptReply(ctx: SwarmCtx, text: string): { agent: string; content: string } {
  const mentioned = text.toLowerCase();
  if (/@?(nova|product)/.test(mentioned))
    return {
      agent: "nova",
      content: `On it — adjusting the spec for: "${text.slice(0, 120)}". I'll reflect this in the next revision; noting it against ${ctx.product}'s capability list now.`,
    };
  if (/@?(vector|arch)/.test(mentioned))
    return {
      agent: "vector",
      content: `Understood. I'll keep the current stack but note "${text.slice(0, 120)}" as a constraint — it affects sequencing, not the shape of the system.`,
    };
  if (/@?(sentinel|review)/.test(mentioned))
    return {
      agent: "sentinel",
      content: `Noted for the review pass — I'll add "${text.slice(0, 90)}" to my checklist before approval.`,
    };
  return {
    agent: "atlas",
    content: `Copy that, Commander. I've logged "${text.slice(0, 120)}" as a mission constraint and briefed the swarm. Continuing the run — interrupt me any time.`,
  };
}
