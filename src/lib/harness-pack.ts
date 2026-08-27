import { HARNESSES } from "@/lib/harnesses";
import type { SwarmCtx } from "@/lib/spec";

export type HarnessFile = {
  path: string;
  title: string;
  content: string;
};

function stackSection(ctx: SwarmCtx): string {
  return `## Stack
- Frontend: ${ctx.stack.frontend}
- Backend: ${ctx.stack.backend}
- Data: ${ctx.stack.data}
${ctx.stack.note ? `- Note: ${ctx.stack.note}` : ""}`;
}

const CONVENTIONS_SECTION = `## Conventions
- Honor the architecture artifact before adding files.
- Don't invent scope the spec didn't ask for.
- Keep types strict; validate mutations server-side.
- Never commit secrets or BYOK keys.`;

function coreBody(ctx: SwarmCtx): string {
  const caps = ctx.features
    .slice(0, 8)
    .map((f) => `- ${f}`)
    .join("\n");
  return `${ctx.tagline}

Shipped by Hivemind from a single spec. Open this repo in any coding agent — they all read one of the files in this pack.

${stackSection(ctx)}

## Capabilities
${caps || "- (see product spec)"}

${CONVENTIONS_SECTION}
`;
}

function wrapMd(title: string, ctx: SwarmCtx): string {
  return `# ${title}\n\n${coreBody(ctx)}`;
}

/** Guidance files every major coding harness can pick up cold. */
export function genHarnessPack(ctx: SwarmCtx): HarnessFile[] {
  // CLAUDE.md / GEMINI.md carry the same notes as AGENTS.md (same convention
  // this repo uses) so every harness reads one file and nothing drifts.
  const shared = wrapMd(ctx.product, ctx);
  const body = coreBody(ctx);
  const files: HarnessFile[] = [
    {
      path: "AGENTS.md",
      title: "AGENTS.md",
      content: shared,
    },
    {
      path: "CLAUDE.md",
      title: "CLAUDE.md",
      content: shared,
    },
    {
      path: "GEMINI.md",
      title: "GEMINI.md",
      content: shared,
    },
    {
      path: "CONVENTIONS.md",
      title: "CONVENTIONS.md",
      content: `# ${ctx.product} — Conventions\n\n${stackSection(ctx)}\n\n${CONVENTIONS_SECTION}\n`,
    },
    {
      path: ".cursor/rules/project.mdc",
      title: ".cursor/rules/project.mdc",
      content: `---
description: ${ctx.product} project conventions
alwaysApply: true
---

# ${ctx.product}

${body}`,
    },
  ];

  const index = [
    `# Harness pack — ${ctx.product}`,
    "",
    "Drop these next to the shipped source so any coding agent can continue the work:",
    "",
    ...HARNESSES.map((h) => `- **${h.name}** (\`${h.id}\`) — reads ${h.guidance.map((g) => `\`${g}\``).join(", ")}`),
    "",
    "Forge's execution bridge for this mission is independent of this pack. The pack is for the *next* agent that opens the repo.",
  ].join("\n");

  files.unshift({
    path: "HARNESS.md",
    title: "HARNESS.md",
    content: index,
  });

  return files;
}

export function harnessPackSummary(files: HarnessFile[]): string {
  return files.map((f) => `\`${f.path}\``).join(", ");
}
