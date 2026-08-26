/** Coding-agent harness registry. Atlas dispatches workers; Hivemind Native is the return hub. */

export type HarnessId =
  | "hive"
  | "claude-code"
  | "grok"
  | "cursor"
  | "codex"
  | "aider"
  | "gemini"
  | "opencode";

export type HarnessDef = {
  id: HarnessId;
  name: string;
  vendor: string;
  glyph: string;
  hue: number;
  desc: string;
  /** Display command. `{task}` is replaced at render time. */
  template: string;
  /** First PATH name to probe. Null means in-process (always available). */
  bin: string | null;
  /** Extra binaries to probe if `bin` is missing. */
  detect: string[];
  /** Guidance files this harness reads when opening a repo. */
  guidance: string[];
};

export const HARNESSES: HarnessDef[] = [
  {
    id: "hive",
    name: "Hivemind Native",
    vendor: "built-in",
    glyph: "⌘",
    hue: 26,
    desc: "Home base. Spec, architecture, critique, integration, review, and QA happen here. External harnesses return their patches to this hub.",
    template: "hive-cli run \"{task}\"",
    bin: null,
    detect: [],
    guidance: ["AGENTS.md", "CLAUDE.md"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    glyph: "✳",
    hue: 18,
    desc: "Anthropic's agentic coding CLI. Strong at multi-file refactors.",
    template: "claude -p \"{task}\"",
    bin: "claude",
    detect: ["claude"],
    guidance: ["CLAUDE.md"],
  },
  {
    id: "grok",
    name: "Grok",
    vendor: "xAI",
    glyph: "✦",
    hue: 38,
    desc: "xAI's coding TUI. Reads AGENTS.md and CLAUDE.md in the repo root.",
    template: "grok \"{task}\"",
    bin: "grok",
    detect: ["grok"],
    guidance: ["AGENTS.md", "CLAUDE.md"],
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    glyph: "▏",
    hue: 210,
    desc: "Cursor agent CLI. Picks up .cursor/rules and AGENTS.md.",
    template: "cursor-agent -p \"{task}\"",
    bin: "cursor-agent",
    detect: ["cursor-agent", "cursor"],
    guidance: [".cursor/rules/project.mdc", "AGENTS.md"],
  },
  {
    id: "codex",
    name: "Codex CLI",
    vendor: "OpenAI",
    glyph: "⏣",
    hue: 152,
    desc: "OpenAI's terminal agent for local generation and edits.",
    template: "codex exec \"{task}\"",
    bin: "codex",
    detect: ["codex"],
    guidance: ["AGENTS.md"],
  },
  {
    id: "aider",
    name: "Aider",
    vendor: "open source",
    glyph: "✎",
    hue: 198,
    desc: "Git-aware pair-programming in the terminal.",
    template: "aider --message \"{task}\"",
    bin: "aider",
    detect: ["aider"],
    guidance: ["CONVENTIONS.md", "AGENTS.md"],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    glyph: "✧",
    hue: 266,
    desc: "Google's open-source terminal agent. Reads GEMINI.md.",
    template: "gemini -p \"{task}\"",
    bin: "gemini",
    detect: ["gemini"],
    guidance: ["GEMINI.md"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    glyph: "◈",
    hue: 312,
    desc: "Open-source coding agent. Uses AGENTS.md at the repo root.",
    template: "opencode run \"{task}\"",
    bin: "opencode",
    detect: ["opencode"],
    guidance: ["AGENTS.md"],
  },
];

export const harnessById = (id: string): HarnessDef =>
  HARNESSES.find((h) => h.id === id) ?? HARNESSES[0];

export const cliAgentById = harnessById;

export const isHarnessId = (id: string): id is HarnessId =>
  HARNESSES.some((h) => h.id === id);

export function renderHarnessCmd(h: HarnessDef, task: string): string {
  return h.template.replace("{task}", task);
}
