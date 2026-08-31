/**
 * Spec parsing + mission context. Hivemind runs live models only — there is
 * no simulation engine; when a call fails the swarm halts and says why.
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

export function approvalAsk(tasks: number, specVersion: number): string {
  return `Plan is stable after critique: **${tasks} tasks**, spec v${specVersion}, architecture locked. Commander — approve the build and Forge starts immediately, or reply with changes.`;
}

/** Which agent answers an @-mention (or any interrupt). */
export function interruptAgent(text: string): string {
  const mentioned = text.toLowerCase();
  if (/@?(nova|product)/.test(mentioned)) return "nova";
  if (/@?(vector|arch)/.test(mentioned)) return "vector";
  if (/@?(sentinel|review)/.test(mentioned)) return "sentinel";
  return "atlas";
}
