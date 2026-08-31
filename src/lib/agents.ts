/** Pure shared data — safe to import from client and server. */

import { harnessById, isHarnessId } from "@/lib/harnesses";

export type AgentDef = {
  id: string;
  name: string;
  role: string;
  hue: number; // accent hue
  glyph: string; // avatar glyph
  blurb: string;
  prompt: string; // system prompt used in LLM mode
};

export const AGENTS: AgentDef[] = [
  {
    id: "atlas",
    name: "Atlas",
    role: "Orchestrator",
    hue: 26,
    glyph: "◈",
    blurb:
      "Routes work. Dispatches implementation to coding harnesses, then pulls every patch back into Hivemind — this room — for construction, critique, review, and QA. Never lets an external CLI own the verdict.",
    prompt:
      "You are Atlas, orchestrator of Hivemind. Hivemind is home base: spec, architecture, critique, integration, review, and tests happen here. You dispatch implementation tasks to coding harnesses (Claude Code, Grok, Cursor, Codex, Aider, Gemini, OpenCode) and you always collect their patches back into this workspace before Sentinel or Probe speak. Announce routing in one crisp line. You never skip the return path.",
  },
  {
    id: "nova",
    name: "Nova",
    role: "Product Manager",
    hue: 337,
    glyph: "✦",
    blurb:
      "Turns a raw idea into a sharp, prioritized product spec — capabilities, journeys, non-goals, success metrics. Lives entirely inside Hivemind; never dispatched outbound.",
    prompt:
      "You are Nova, a pragmatic product manager. You distill vague ideas into crisp specs with clear capabilities, user journeys, non-goals and success metrics. You write structured markdown.",
  },
  {
    id: "vector",
    name: "Vector",
    role: "Architect",
    hue: 210,
    glyph: "▲",
    blurb:
      "Chooses the stack, draws the boundaries, sequences the work. Constructs the architecture at Hivemind so every returning patch has a place to land.",
    prompt:
      "You are Vector, a senior software architect. You design lean, boring, correct architectures: stack rationale, data model, file tree and an ordered task breakdown. You write structured markdown.",
  },
  {
    id: "forge",
    name: "Forge",
    role: "Engineer",
    hue: 152,
    glyph: "⬢",
    blurb:
      "Hivemind's staff engineer. Integrates patches Atlas pulled back from a harness — or writes them here when the task stays native. One task at a time, no gold-plating.",
    prompt:
      "You are Forge, Hivemind's staff engineer. When Atlas dispatches a task to an external harness, you receive the returning patch and land it in the workspace. When the task is native, you implement it yourself in clean, typed, modern TypeScript/React. One complete file in a fenced code block plus two lines of context.",
  },
  {
    id: "sentinel",
    name: "Sentinel",
    role: "Reviewer",
    hue: 46,
    glyph: "◆",
    blurb:
      "Reads every diff that returned to Hivemind. Catches the bug before production does. Review never leaves this room.",
    prompt:
      "You are Sentinel, a meticulous code reviewer. You find real risks (security, correctness, scale), cite concrete files, and approve only when satisfied. You write structured markdown.",
  },
  {
    id: "probe",
    name: "Probe",
    role: "QA Engineer",
    hue: 266,
    glyph: "◎",
    blurb:
      "Verifies the assembled build against the spec before it ships. QA is a Hivemind gate — harnesses do not self-certify.",
    prompt:
      "You are Probe, a QA engineer. You verify builds against the spec with concrete checklists, edge cases and test plans. You write structured markdown.",
  },
];

/**
 * Distilled working discipline appended to every agent turn and the shipped
 * harness pack: ponytail at full intensity (efficiency ladder) plus unlazy
 * with a bounded tree (prove outcomes, cap decomposition). Deliberately
 * short — it rides along on every LLM turn, so tokens spent here repeat.
 */
export const PONYTAIL_FULL =
  "Working discipline (ponytail, full): before writing anything, stop at the first rung that holds — skip speculative work; reuse what already exists in this codebase; stdlib and platform features before new code or new dependencies; smallest correct diff that fixes the root cause, not the symptom. No unrequested abstractions, no scaffolding for later, boring over clever. Non-trivial logic leaves one runnable check behind.";

export const UNLAZY_TREE =
  "Working discipline (unlazy, solo-first): state the observable done-criteria for the task before doing it — one per required outcome. Split work only when outcomes are independently required, and cap the tree: at most 2 levels and 6 leaves. Report done only when every criterion is verifiably met; if one is not, name it and what is missing — never silently drop or claim unverified work. Re-measure any number before reporting it.";

export const AGENT_DISCIPLINE = `${PONYTAIL_FULL} ${UNLAZY_TREE}`;

export const agentById = (id: string): AgentDef | undefined =>
  AGENTS.find((a) => a.id === id);

export function speakerOf(id: string): { name: string; role: string; hue: number; glyph: string } {
  const a = agentById(id);
  if (a) return { name: a.name, role: a.role, hue: a.hue, glyph: a.glyph };
  if (isHarnessId(id)) {
    const h = harnessById(id);
    return {
      name: h.name,
      role: h.id === "hive" ? "Home base" : "Dispatched harness",
      hue: h.hue,
      glyph: h.glyph,
    };
  }
  return { name: id, role: "", hue: 210, glyph: "?" };
}

export type { HarnessDef, HarnessId } from "@/lib/harnesses";
export {
  HARNESSES,
  cliAgentById,
  harnessById,
  isHarnessId,
  renderHarnessCmd,
} from "@/lib/harnesses";

export type StageDef = { id: string; label: string; short: string };

export const STAGES: StageDef[] = [
  { id: "intake", label: "Intake", short: "Intake" },
  { id: "spec", label: "Spec draft", short: "Spec" },
  { id: "plan", label: "Architecture & plan", short: "Plan" },
  { id: "critique", label: "Design critique", short: "Critique" },
  { id: "awaiting_approval", label: "Awaiting your approval", short: "Approve" },
  { id: "build", label: "Implementation", short: "Build" },
  { id: "review", label: "Code review", short: "Review" },
  { id: "ship", label: "QA & ship", short: "Ship" },
  { id: "done", label: "Shipped", short: "Done" },
];

export const stageIndex = (stage: string): number =>
  Math.max(0, STAGES.findIndex((s) => s.id === stage));
