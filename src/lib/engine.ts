/**
 * Hivemind orchestrator — a stage machine that drives a group-chat of
 * specialist agents. Streams SwarmEvents (SSE) while persisting every
 * message, artifact and task to Postgres. Live models only: when a call
 * fails or no key is configured the swarm halts with the real reason and
 * points at `doctor` instead of faking output.
 */
import { db } from "@/db";
import {
  projects,
  messages,
  artifacts,
  tasks,
  apiKeys,
  userSettings,
} from "@/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { agentById, cliAgentById, renderHarnessCmd } from "@/lib/agents";
import { cfgFromKey } from "@/lib/key-auth";
import { HOME_HARNESS, routeTasks, staysHome } from "@/lib/harness-route";
import { customHarnessesOf, resolveHarnessDef, type HarnessDef } from "@/lib/harnesses";
import { detectHarness } from "@/lib/detect-harness";
import { genHarnessPack, harnessPackSummary } from "@/lib/harness-pack";
import { streamChat, type ChatMsg, type LlmConfig } from "@/lib/llm";
import { createThinkFilter, stripThink } from "@/lib/think";
import {
  parseSpec,
  approvalAsk,
  interruptAgent,
  type SwarmCtx,
} from "@/lib/spec";
import type { SwarmEvent, TermLine, WireArtifact, WireMessage, WireTask } from "@/lib/events";

const MAX_BEATS = 4;
// Strong approval words count anywhere in a message; weak ones ("yes", "ok",
// "looks good") only count when the message is nothing but the approval — so
// "yes, but change the name" is a revision, not an approval.
const STRONG_APPROVE_RE = /(approve|approved|lgtm|ship it|build it|start build|proceed|go ahead)/i;
const WEAK_APPROVE_RE = /^(?:yes|y|ok|wfm|looks good|ship|build)[\s.!]*$/i;

function isApproval(text: string): boolean {
  if (STRONG_APPROVE_RE.test(text)) return true;
  return text.trim().length <= 24 && WEAK_APPROVE_RE.test(text);
}
// Review-stage override — deliberately tighter than APPROVE_RE so a revision
// note that merely mentions shipping cannot ship over Sentinel's objection.
const SHIP_ANYWAY_RE = /\b(ship it|ship anyway|override|approve|approved|proceed|go ahead|lgtm)\b/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pacing = () => 500 + Math.random() * 550;

type ProjectRow = typeof projects.$inferSelect;

/* ---------------- wire helpers ---------------- */

const wireMsg = (m: typeof messages.$inferSelect): WireMessage => ({
  id: m.id,
  author: m.author,
  kind: m.kind,
  content: m.content,
  meta: m.meta ?? {},
  createdAt: m.createdAt.toISOString(),
});

const wireArtifact = (a: typeof artifacts.$inferSelect): WireArtifact => ({
  id: a.id,
  type: a.type,
  title: a.title,
  path: a.path,
  content: a.content,
  version: a.version,
  createdBy: a.createdBy,
  meta: a.meta ?? {},
  createdAt: a.createdAt.toISOString(),
});

const wireTask = (t: typeof tasks.$inferSelect): WireTask => ({
  id: t.id,
  title: t.title,
  detail: t.detail,
  assignee: t.assignee,
  harness: t.harness,
  status: t.status,
  sort: t.sort,
});

async function persistMsg(
  projectId: number,
  author: string,
  kind: string,
  content: string,
  meta: Record<string, unknown> = {}
): Promise<WireMessage> {
  const [row] = await db
    .insert(messages)
    .values({ projectId, author, kind, content, meta })
    .returning();
  await db
    .update(projects)
    .set({ turnCount: (await getTurnCount(projectId)) + 1, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return wireMsg(row);
}

async function getTurnCount(projectId: number): Promise<number> {
  const [p] = await db
    .select({ turnCount: projects.turnCount })
    .from(projects)
    .where(eq(projects.id, projectId));
  return p?.turnCount ?? 0;
}

async function setStage(projectId: number, stage: string, running: boolean) {
  await db
    .update(projects)
    .set({ stage, running, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

async function taskList(projectId: number): Promise<WireTask[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sort));
  return rows.map(wireTask);
}

type AgentRoute = { keyId?: number; model?: string };

async function agentRoutes(
  userId: number
): Promise<{ routes?: Record<string, AgentRoute>; customs: HarnessDef[]; error?: unknown }> {
  try {
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return {
      routes: (s?.data as { agents?: Record<string, AgentRoute> } | null)?.agents,
      customs: customHarnessesOf(s?.data),
    };
  } catch (e) {
    return { customs: [], error: e };
  }
}

async function resolveCfg(userId: number, agentId: string): Promise<LlmConfig | null> {
  const all = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  const ready = all.filter((k) => k.model.trim());
  if (!ready.length) return null;
  const fallback = ready.find((k) => k.isDefault) ?? ready[0];
  if (!fallback) return null;

  const { routes } = await agentRoutes(userId);

  const assigned = routes?.[agentId]?.keyId ? ready.find((k) => k.id === routes[agentId].keyId) : undefined;
  const key = assigned ?? fallback;
  const model = routes?.[agentId]?.model?.trim() || key.model;
  return cfgFromKey(key, model);
}

/**
 * A finished agent turn. `failed` carries the honest reason when the live
 * call could not produce content — callers halt the mission instead of
 * substituting fake output.
 */
type SpokenResult = { content: string; failed?: string };

async function persistSpoken(
  p: ProjectRow,
  agent: string,
  kind: string,
  spoken: SpokenResult,
  extra: Record<string, unknown> = {}
): Promise<WireMessage> {
  const cfg = await resolveCfg(p.userId, agent);
  return persistMsg(p.id, agent, kind, spoken.content, {
    ...extra,
    ...(cfg ? { provider: cfg.provider, model: cfg.model } : {}),
  });
}

/**
 * Stop the run with the real reason — never fake it. Leaves the stage as-is
 * so Resume works once `doctor` (or Settings) fixes the problem.
 */
async function* llmHalt(p: ProjectRow, agent: string, reason: string): AsyncGenerator<SwarmEvent> {
  const cfg = await resolveCfg(p.userId, agent);
  const route = cfg ? `${cfg.provider} · ${cfg.model}` : "no key configured";
  const name = agentById(agent)?.name ?? agent;
  await db.update(projects).set({ running: false, updatedAt: new Date() }).where(eq(projects.id, p.id));
  yield { type: "term", lines: [{ text: `✗ ${name} halted the run — ${reason}`, tone: "err" }] };
  yield {
    type: "message",
    msg: await persistMsg(
      p.id,
      "system",
      "status",
      `**${name} could not run** (${route}) — ${reason}. The swarm halted rather than fake output. Run \`doctor\` in the terminal to diagnose and fix, then Resume.`
    ),
  };
}

/* ---------------- generator utilities ---------------- */

function ctxOf(p: ProjectRow): SwarmCtx {
  const c = p.ctx as Partial<SwarmCtx> | null;
  if (c && c.product && Array.isArray(c.features)) return c as SwarmCtx;
  return parseSpec(p.spec, p.name);
}

/** Repo paths that arrived with an imported folder (top folder stripped, like artifacts.path). */
function importedPathsOf(p: ProjectRow): Set<string> {
  const files = (p.ctx as { importedFiles?: string[] } | null)?.importedFiles;
  return new Set((Array.isArray(files) ? files : []).map((f) => f.replace(/^[^/]+\//, "")));
}

/**
 * Prompt digest of an imported codebase: the file tree plus excerpts of a few
 * key files, so live-model turns work against the real repo instead of the
 * spec text alone. Empty for missions that started from a pasted spec.
 */
async function codebaseDigest(p: ProjectRow): Promise<string> {
  const paths = importedPathsOf(p);
  if (!paths.size) return "";
  const rows = await db
    .select({ path: artifacts.path, content: artifacts.content })
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")))
    .orderBy(asc(artifacts.id));
  const imported = rows.filter((r) => r.path && paths.has(r.path));
  if (!imported.length) return "";
  const tree = imported
    .slice(0, 40)
    .map((r) => `- \`${r.path}\``)
    .join("\n");
  const excerpts = imported
    .filter((r) => /(^|\/)(readme|package\.json|schema|db|main|index|app|route|api)/i.test(r.path ?? ""))
    .slice(0, 4)
    .map((r) => `\`\`\`\n${r.path}\n${r.content.slice(0, 1400)}\n\`\`\``)
    .join("\n");
  return (
    `\nImported codebase — ${imported.length} files already in the workbench:\n${tree}\n` +
    (excerpts ? `\nKey files:\n${excerpts}\n` : "") +
    `\nThe repo already exists. Extend and modify it; do not scaffold a blank app.`
  );
}

/** Build a streamed agent turn. Returns the content, or the honest failure reason. */
async function* spokenTurn(
  p: ProjectRow,
  agent: string,
  opts: {
    instruction: string; // LLM instruction
    maxTokens?: number;
    silent?: boolean; // stream without chat deltas (machine-parsed turns)
  }
): AsyncGenerator<SwarmEvent, SpokenResult> {
  yield { type: "turn_start", agent };
  const cfg = await resolveCfg(p.userId, agent);
  if (!cfg) {
    return { content: "", failed: "no key configured for this agent — add one in Settings or run `doctor`" };
  }
  const sys = agentById(agent)?.prompt ?? "You are a helpful agent.";
  const ctx = ctxOf(p);
  const digest = await codebaseDigest(p);
  const chat: ChatMsg[] = [
    { role: "system", content: sys },
    {
      role: "user",
      content:
        `Project: ${ctx.product}\nVision: ${ctx.tagline}\nCapabilities: ${ctx.features.join("; ")}\n${digest}\n\n` +
        opts.instruction +
        "\n\nReply in character only. Do not include <think> blocks, hidden reasoning, or analysis of the instructions.",
    },
  ];
  let content = "";
  const think = createThinkFilter();
  let failedMsg = "";
  try {
    for await (const tok of streamChat(cfg, chat, opts.maxTokens ?? 1400)) {
      const visible = think.push(tok);
      if (!visible) continue;
      content += visible;
      if (!opts.silent) yield { type: "delta", agent, text: visible };
    }
    const tail = think.flush();
    if (tail) {
      content += tail;
      if (!opts.silent) yield { type: "delta", agent, text: tail };
    }
  } catch (e) {
    failedMsg = e instanceof Error ? e.message : String(e);
    console.error(`spokenTurn(${agent}, ${cfg.provider}/${cfg.model}) failed: ${failedMsg}`);
    content = "";
  }
  content = stripThink(content);
  if (!content.trim()) {
    // Never fake a live reply — report the exact failure and let the caller halt.
    const reason = failedMsg
      ? `live call failed (${cfg.provider} · ${cfg.model}): ${failedMsg.slice(0, 160)}`
      : `live model returned empty (${cfg.provider} · ${cfg.model})`;
    yield { type: "term", lines: [{ text: `✗ ${reason}`, tone: "err" }] };
    return { content: "", failed: reason };
  }
  return { content };
}

/** Consume spokenTurn, forwarding events through `emit`, and return the result. */
async function speak(
  gen: AsyncGenerator<SwarmEvent, SpokenResult>,
  emit: (ev: SwarmEvent) => void
): Promise<SpokenResult> {
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
    emit(step.value);
  }
}

/** Parse a model task list: first JSON array of {title, detail} objects. Null if unusable. */
function parseTasks(text: string): { title: string; detail: string }[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    try {
      // Models love trailing commas; JSON does not.
      raw = JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  const parsed = raw
    .map((t) => {
      const o = t as { title?: unknown; detail?: unknown };
      return {
        title: String(o?.title ?? "").trim().slice(0, 120),
        detail: String(o?.detail ?? "").trim().slice(0, 400),
      };
    })
    .filter((t) => t.title.length >= 4);
  if (parsed.length < 2 || parsed.length > 12) return null;
  return parsed.slice(0, 10);
}

/**
 * Derive the build task list: Vector extracts real tasks from the spec +
 * architecture (+ the imported tree, already in the turn context). One retry
 * with a format reminder before giving up.
 */
async function planTasksFor(
  p: ProjectRow,
  ctx: SwarmCtx,
  archDoc: string,
  emit: (ev: SwarmEvent) => void
): Promise<{ tasks: { title: string; detail: string }[] } | { failed: string }> {
  const imported = importedPathsOf(p).size > 0;
  const arch = archDoc.length > 2400 ? `${archDoc.slice(0, 2400)}\n…(truncated)` : archDoc;
  const instruction =
    (imported
      ? "Derive the implementation task list for EXTENDING the existing imported codebase above. Every task must modify or add to what already exists — never scaffold a fresh app over it."
      : "Derive the implementation task list from the spec and the architecture document below.") +
    `\n\nArchitecture document:\n${arch}\n\nRespond with ONLY a JSON array of 4-8 objects: [{"title": "...", "detail": "..."}]. Titles are short imperative work items; details are one sentence naming the files or surfaces involved. No prose, no code fences.`;
  const run = (extra: string) =>
    speak(
      spokenTurn(p, "vector", { instruction: instruction + extra, maxTokens: 2000, silent: true }),
      emit
    );
  let r = await run("");
  if (!r.failed) {
    const parsed = parseTasks(r.content);
    if (parsed) return { tasks: parsed };
    r = await run("\n\nREMINDER: respond with ONLY the raw JSON array — no prose, no code fences, no trailing commas.");
    if (!r.failed) {
      const retry = parseTasks(r.content);
      if (retry) return { tasks: retry };
      return { failed: "task extraction returned no usable JSON task list after one retry" };
    }
  }
  return { failed: r.failed };
}

/* ---------------- live construction (Phase 2) ---------------- */

type GeneratedFile = { path: string; content: string };

/** Repo-relative output paths only — no absolute, traversal, or odd characters. */
export function safeOutPath(raw: string): string | null {
  const path = raw.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!path || path.length > 120 || path.includes("..") || /[^a-zA-Z0-9._/-]/.test(path)) return null;
  return path;
}

const JUNK_SEGMENTS = new Set([
  ".build",
  "node_modules",
  ".next",
  ".git",
  ".cache",
  ".tmp",
  "dist",
  "coverage",
  "__pycache__",
]);

/**
 * Build-output and scratch territory — models sometimes "helpfully" emit
 * debug scripts, fake fixtures, or compiled bundles there, and anything
 * written can never be deleted, so it must never be reviewed either.
 */
function isJunkOutPath(path: string): boolean {
  const segs = path.split("/");
  return segs.some((s, i) => JUNK_SEGMENTS.has(s) || (i < segs.length - 1 && /\.app$/.test(s)));
}

/** Parse Forge's FILE-block output (1–3 files) into paths + contents. Null if unusable. */
function parseGeneratedFiles(text: string): { files: GeneratedFile[]; summary: string } | null {
  const files: GeneratedFile[] = [];
  const re = /FILE:\s*`?([^\n`]+?)`?\s*\n+```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && files.length < 3) {
    const path = safeOutPath(m[1]);
    const content = m[2].trimEnd();
    if (path && !isJunkOutPath(path) && content.trim().length > 20) files.push({ path, content: `${content}\n` });
  }
  // Budget-truncated output can leave the last fence unclosed; salvage it.
  if (!files.length) {
    const open = text.match(/FILE:\s*`?([^\n`]+?)`?\s*\n+```[a-zA-Z0-9]*\r?\n([\s\S]+)$/);
    if (open) {
      const path = safeOutPath(open[1]);
      const content = open[2].trimEnd();
      if (path && !isJunkOutPath(path) && content.trim().length > 20) files.push({ path, content: `${content}\n` });
    }
  }
  if (!files.length) return null;
  const sum = text.match(/SUMMARY:\s*(.+)/i);
  return { files, summary: sum ? sum[1].trim().slice(0, 200) : "" };
}

/** Paths + capped excerpts of files already in the workspace, for Forge's context. */
async function priorFilesDigest(p: ProjectRow): Promise<string> {
  const packPaths = new Set(genHarnessPack(ctxOf(p)).map((f) => f.path));
  const rows = await db
    .select({ path: artifacts.path, content: artifacts.content })
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")))
    .orderBy(asc(artifacts.id));
  const latest = new Map<string, string>();
  for (const r of rows) {
    if (!r.path || packPaths.has(r.path)) continue;
    latest.set(r.path, r.content);
  }
  const list = [...latest.entries()].slice(-8); // most recent context wins
  if (!list.length) return "";
  return list
    .map(([path, content]) => {
      // Reviewers must see the whole file or they flag "missing" code that
      // exists past the excerpt; truncate only what truly won't fit.
      const body =
        content.length <= 16_000
          ? content
          : `${content.slice(0, 2000)}\n…(middle truncated — ${content.length - 3000} chars)…\n${content.slice(-1000)}`;
      return `- ${path}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n");
}

/**
 * Live per-task code generation. Returns parsed files, or null when the model
 * could not produce a usable output after one retry.
 */
async function forgeTurn(
  p: ProjectRow,
  task: typeof tasks.$inferSelect,
  emit: (ev: SwarmEvent) => void
): Promise<{ files: GeneratedFile[]; summary: string } | { failed: string }> {
  const imported = importedPathsOf(p).size > 0;
  const [archRow] = await db
    .select({ content: artifacts.content })
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "arch")))
    .orderBy(desc(artifacts.version))
    .limit(1);
  const arch = archRow ? archRow.content.slice(0, 2000) : "";
  const prior = await priorFilesDigest(p);
  const instruction =
    `Implement this task completely:\n**${task.title}** — ${task.detail}\n\n` +
    (arch ? `Architecture:\n${arch}\n\n` : "") +
    (prior ? `Files already in the workspace:\n${prior}\n\n` : "") +
    (imported
      ? "This mission extends an existing imported codebase — modify or add files that fit it; do not re-scaffold.\n\n"
      : "") +
    "Output 1-3 complete files using EXACTLY this format, nothing before or after:\n\n" +
    "FILE: <repo-relative path>\n```<language>\n<complete file content>\n```\n\n" +
    "SUMMARY: <one sentence on what you built>";
  const run = (extra: string) =>
    speak(
      spokenTurn(p, "forge", { instruction: instruction + extra, maxTokens: 8000, silent: true }),
      emit
    );
  let r = await run("");
  if (!r.failed) {
    const parsed = parseGeneratedFiles(r.content);
    if (parsed) return parsed;
    r = await run("\n\nREMINDER: the response must start with `FILE: <path>` followed by a fenced code block.");
    if (!r.failed) {
      const retry = parseGeneratedFiles(r.content);
      if (retry) return retry;
      const glimpse = r.content.replace(/\s+/g, " ").trim().slice(0, 140);
      return { failed: `generation returned no usable FILE block after one retry — model replied: "${glimpse}…"` };
    }
  }
  return { failed: r.failed };
}

/** Write a generated file as a new version if the path exists, else a fresh artifact. */
async function writeFileArtifact(
  p: ProjectRow,
  file: GeneratedFile,
  meta: Record<string, unknown>
): Promise<WireArtifact> {
  const [existing] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file"), eq(artifacts.path, file.path)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (existing) {
    const [upd] = await db
      .update(artifacts)
      .set({ content: file.content, version: existing.version + 1, createdBy: "forge", meta, updatedAt: new Date() })
      .where(eq(artifacts.id, existing.id))
      .returning();
    return wireArtifact(upd);
  }
  return insertArtifact(p.id, "file", file.path, file.content, "forge", 1, file.path, meta);
}

/* ---------------- live review (Phase 3) ---------------- */

type ReviewVerdict = { approved: boolean; changes: string[] };

/** Read Sentinel's mandatory verdict line. Null when the model skipped it. */
function parseVerdict(text: string): ReviewVerdict | null {
  const m = text.match(/VERDICT:\s*(APPROVED|CHANGES?)(?:\s*:\s*([^\n]+))?/i);
  if (!m) return null;
  if (m[1].toUpperCase() === "APPROVED") return { approved: true, changes: [] };
  const changes = (m[2] ?? "")
    .split(/[,;]+/)
    .map((s) => safeOutPath(s))
    .filter((s): s is string => !!s);
  return { approved: false, changes: changes.slice(0, 4) };
}

/**
 * One Forge turn applying review findings to a named file.
 * ok: updated file · halt: live-call failure (mission must stop) ·
 * unfixed: model answered but produced nothing usable for this path.
 */
type FixResult = { status: "ok"; file: GeneratedFile } | { status: "halt"; reason: string } | { status: "unfixed" };

async function fixTurn(
  p: ProjectRow,
  path: string,
  reviewDoc: string,
  emit: (ev: SwarmEvent) => void
): Promise<FixResult> {
  const [cur] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file"), eq(artifacts.path, path)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (!cur) return { status: "unfixed" };
  const r = await speak(
    spokenTurn(p, "forge", {
      instruction:
        `A code review flagged \`${path}\`. Apply the findings to it and return the COMPLETE updated file.\n\n` +
        `Review findings:\n${reviewDoc.slice(0, 1500)}\n\n` +
        `Current ${path}:\n\`\`\`\n${cur.content.slice(0, 8000)}\n\`\`\`\n\n` +
        `Output EXACTLY one file:\nFILE: ${path}\n\`\`\`<language>\n<complete updated content>\n\`\`\``,
      maxTokens: 8000,
      silent: true,
    }),
    emit
  );
  if (r.failed) return { status: "halt", reason: r.failed };
  const file = parseGeneratedFiles(r.content)?.files.find((f) => f.path === path);
  return file ? { status: "ok", file } : { status: "unfixed" };
}

/* ---------------- the orchestrator ---------------- */

export async function* runSwarm(
  projectId: number,
  userId: number,
  signal?: AbortSignal
): AsyncGenerator<SwarmEvent> {
  const queue: SwarmEvent[] = [];
  const emit = (ev: SwarmEvent) => queue.push(ev);
  const flush = function* (): Generator<SwarmEvent> {
    while (queue.length) yield queue.shift()!;
  };

  const p0 = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  if (!p0.length) return;
  const start = p0[0];
  if (start.stage === "done") {
    yield { type: "end", stage: "done", running: false, awaiting: false };
    return;
  }
  await db.update(projects).set({ running: true, updatedAt: new Date() }).where(eq(projects.id, projectId));
  yield { type: "mode", llm: !!(await resolveCfg(userId, "atlas")) };
  const { error: routesError } = await agentRoutes(userId);
  if (routesError) {
    yield {
      type: "term",
      lines: [{ text: "could not read agent routes — per-agent model routing ignored this run", tone: "warn" }],
    };
  }

  try {
    for (let beat = 0; beat < MAX_BEATS; beat++) {
      if (signal?.aborted) break;
      const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!p || !p.running) break;

      const beforeTurns = p.turnCount;
      // Drain queued events (nested emit) before each yielded one so the
      // client sees turns land one by one instead of one burst per stage —
      // activity indicators depend on it. Order stays chronological.
      const stream = p.interrupt && p.interrupt.trim() ? handleInterrupt(p, emit) : stepStage(p, emit);
      for await (const ev of stream) {
        yield* flush();
        yield ev;
      }
      yield* flush();

      const [after] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!after || !after.running) break;
      // Safety: a beat that produced nothing must not loop forever.
      if (after.turnCount === beforeTurns && after.stage === p.stage) break;
      await sleep(420);
    }
  } finally {
    // Decide whether the mission stays resumable. `fin.running` is still the
    // pre-loop value here unless someone paused us mid-run — so a beat-budget
    // rollover or client disconnect keeps it true (the client reconnects),
    // while a pause or a stage gate (approval, done) leaves it parked.
    const [fin] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const stage = fin?.stage ?? "done";
    const gated = stage === "awaiting_approval" || stage === "done";
    const resume = !!fin && fin.running && !gated;
    if (fin) {
      await db.update(projects).set({ running: resume, updatedAt: new Date() }).where(eq(projects.id, projectId));
    }
    yield {
      type: "end",
      stage,
      running: resume,
      awaiting: stage === "awaiting_approval",
    };
  }
}

/* ---------------- interrupt handling ---------------- */

async function* handleInterrupt(p: ProjectRow, emit: (ev: SwarmEvent) => void): AsyncGenerator<SwarmEvent> {
  const text = (p.interrupt ?? "").trim();
  await db.update(projects).set({ interrupt: null }).where(eq(projects.id, p.id));
  const ctx = ctxOf(p);

  if (p.stage === "awaiting_approval") {
    if (isApproval(text)) {
      yield* approveBuild(p);
      return;
    }
    // Revision request — rework the spec, keep waiting for approval.
    const replyAgent = interruptAgent(text);
    const spoken = await (yield* speakInterrupt(p, replyAgent, text));
    if (spoken.failed) {
      yield* llmHalt(p, replyAgent, spoken.failed);
      return;
    }
    yield { type: "message", msg: await persistSpoken(p, replyAgent, "chat", spoken) };
    const v = await nextVersion(p.id, "spec");
    const rev = await speak(
      spokenTurn(p, "nova", {
        instruction: `Rewrite the product spec as v2 absorbing the commander's revision notes below. Keep the same structure (vision, problem, capability table, primary journey, non-goals, success metrics). Output complete markdown only.\n\nRevision notes: ${text}\n\nCurrent spec:\n${(await latestSpecOf(p.id)) ?? ""}`,
        maxTokens: 3000,
        silent: true,
      }),
      emit
    );
    if (rev.failed) {
      yield* llmHalt(p, "nova", rev.failed);
      return;
    }
    const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v${v}`, rev.content, "nova", v, null, { generated: true });
    yield { type: "artifact", artifact: art };
    yield {
      type: "message",
      msg: await persistMsg(p.id, "atlas", "chat", `Spec revised to **v${v}** with your notes. Plan still holds — approve when ready, Commander.`),
    };
    await setStage(p.id, "awaiting_approval", false);
    yield { type: "stage", stage: "awaiting_approval" };
    return;
  }

  if (p.stage === "review" && SHIP_ANYWAY_RE.test(text)) {
    // Unresolved review: only the Commander can ship over Sentinel's objection.
    await persistMsg(p.id, "system", "status", "Commander shipped over the review objection.");
    await setStage(p.id, "ship", true);
    yield { type: "stage", stage: "ship" };
    return;
  }

  const replyAgent = interruptAgent(text);
  const spoken = await (yield* speakInterrupt(p, replyAgent, text));
  if (spoken.failed) {
    yield* llmHalt(p, replyAgent, spoken.failed);
    return;
  }
  yield { type: "message", msg: await persistSpoken(p, replyAgent, "chat", spoken) };
}

async function* speakInterrupt(p: ProjectRow, agent: string, text: string): AsyncGenerator<SwarmEvent, SpokenResult> {
  const gen = spokenTurn(p, agent, {
    instruction: `The human commander just said: "${text}". Respond in character in 2-3 sentences, acknowledging and stating what you'll adjust.`,
    maxTokens: 800,
  });
  yield { type: "turn_start", agent };
  let result: SpokenResult = { content: "", failed: "interrupt reply never ran" };
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      result = step.value;
      break;
    }
    if (step.value.type !== "turn_start") yield step.value;
  }
  return result;
}

/** Latest spec document, for revision turns. */
async function latestSpecOf(projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ content: artifacts.content })
    .from(artifacts)
    .where(and(eq(artifacts.projectId, projectId), eq(artifacts.type, "spec")))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return row?.content.slice(0, 4000) ?? null;
}

async function* approveBuild(p: ProjectRow): AsyncGenerator<SwarmEvent> {
  yield {
    type: "message",
    msg: await persistMsg(
      p.id,
      "atlas",
      "stage",
      "✅ **Build approved.** Atlas has the con — implementation fans out to harnesses, every patch returns to Hivemind for integration, review, and QA."
    ),
  };
  const queued = await taskList(p.id);
  const lines: TermLine[] = [
    { text: `$ hivemind dispatch --mission "${p.name}"`, tone: "cmd" },
    { text: "◈ hub: Hivemind Native · workers rotate per task · return path is this room", tone: "ok" },
  ];
  for (const t of queued) {
    const h = cliAgentById(t.harness);
    lines.push({ text: `  → ${t.title}  [${h.name}]`, tone: "dim" });
  }
  yield { type: "term", lines };
  await setStage(p.id, "build", true);
  yield { type: "stage", stage: "build" };
}

/* ---------------- stage machine ---------------- */

async function* stepStage(p: ProjectRow, emit: (ev: SwarmEvent) => void): AsyncGenerator<SwarmEvent> {
  const ctx = ctxOf(p);

  switch (p.stage) {
    case "intake": {
      const imported = Boolean((p.ctx as { imported?: boolean } | null)?.imported);
      await db
        .update(projects)
        .set({ ctx: { ...(p.ctx as object), ...ctx } as unknown as Record<string, unknown> })
        .where(eq(projects.id, p.id));
      const importedFiles = Array.isArray((p.ctx as { importedFiles?: string[] } | null)?.importedFiles)
        ? ((p.ctx as { importedFiles: string[] }).importedFiles.length)
        : 0;
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "atlas",
          "stage",
          imported
            ? `**Mission imported: ${ctx.product}.** ${importedFiles || "Existing"} files are already in the workbench. Hivemind is home base — Nova reads this tree, Vector maps it, Sentinel and Probe stay here. I will dispatch only what still needs building.`
            : `**Mission received: ${ctx.product}.** Hivemind is home base — Nova on product, Vector on architecture, Sentinel on critique, Probe on QA. I will dispatch implementation to coding harnesses and pull every patch back here.`
        ),
      };
      yield {
        type: "term",
        lines: [
          { text: `$ hivemind run --mission "${p.name}"`, tone: "cmd" },
          { text: "◈ swarm assembled · atlas ◈  nova ✦  vector ▲  forge ⬢  sentinel ◆  probe ◎", tone: "dim" },
          { text: "✓ session attached — orchestrator has the con", tone: "ok" },
        ],
      };
      const ack = await speak(spokenTurn(p, "nova", {
        instruction: `Acknowledge the mission brief in 2-3 sentences. Mention that you extracted ${ctx.features.length} capabilities and are drafting the spec. Be warm and crisp.`,
        maxTokens: 800,
      }), emit);
      if (ack.failed) {
        yield* llmHalt(p, "nova", ack.failed);
        return;
      }
      yield { type: "message", msg: await persistSpoken(p, "nova", "chat", ack) };
      await setStage(p.id, "spec", true);
      yield { type: "stage", stage: "spec" };
      return;
    }

    case "spec": {
      const doc = await speak(spokenTurn(p, "nova", {
        instruction: "Write the complete v1 product spec as structured markdown (vision, problem, capability table, primary journey, non-goals, success metrics). Output markdown only.",
        maxTokens: 3000,
      }), emit);
      if (doc.failed) {
        yield* llmHalt(p, "nova", doc.failed);
        return;
      }
      const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v1`, doc.content, "nova", 1, null, { generated: true });
      yield { type: "artifact", artifact: art };
      yield {
        type: "message",
        msg: await persistSpoken(p, "nova", "artifact", {
          content: `Spec v1 is on the table — ${ctx.features.length} capabilities, journeys mapped, non-goals set. Vector, it's yours to architect.`,
        }, { artifactId: art.id }),
      };
      await setStage(p.id, "plan", true);
      yield { type: "stage", stage: "plan" };
      return;
    }

    case "plan": {
      const doc = await speak(spokenTurn(p, "vector", {
        instruction: "Write the architecture document as markdown: stack table with rationale, a small ASCII system diagram, core data model, file tree, and invariants. Output markdown only.",
        maxTokens: 3000,
      }), emit);
      if (doc.failed) {
        yield* llmHalt(p, "vector", doc.failed);
        return;
      }
      const art = await insertArtifact(p.id, "arch", `${ctx.product} — Architecture v1`, doc.content, "vector", 1, null, { generated: true });
      yield { type: "artifact", artifact: art };

      yield { type: "turn_start", agent: "vector" };
      const plan = await planTasksFor(p, ctx, doc.content, emit);
      if ("failed" in plan) {
        yield* llmHalt(p, "vector", plan.failed);
        return;
      }
      const { customs: planCustoms } = await agentRoutes(p.userId);
      const routed = routeTasks(plan.tasks.map((t) => t.title), p.cliAgent, planCustoms);
      let i = 0;
      for (const t of plan.tasks) {
        await db.insert(tasks).values({
          projectId: p.id,
          title: t.title,
          detail: t.detail,
          assignee: "forge",
          harness: routed[i] ?? HOME_HARNESS,
          status: "backlog",
          sort: i,
        });
        i += 1;
      }
      yield { type: "tasks", tasks: await taskList(p.id) };
      yield {
        type: "message",
        msg: await persistSpoken(p, "vector", "artifact", {
          content: `Architecture locked and **${plan.tasks.length} tasks** sequenced. Deliberately boring tech, sharp interfaces. Sentinel — tear it apart before we commit.`,
        }, { artifactId: art.id }),
      };
      const map = (await taskList(p.id))
        .map((t) => `- **${t.title}** → ${cliAgentById(t.harness).name}${staysHome(t.title) ? " *(stays in Hivemind)*" : " *(returns here)*"}`)
        .join("\n");
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "atlas",
          "chat",
          `**Dispatch map.** Implementation fans out; construction, critique, review, and QA stay in this room.\n\n${map}`
        ),
      };
      await setStage(p.id, "critique", true);
      yield { type: "stage", stage: "critique" };
      return;
    }

    case "critique": {
      const c1 = await speak(spokenTurn(p, "sentinel", {
        instruction: `Raise two concrete design-review concerns about this plan (input validation + rate limiting, and unbounded table growth). Write them as short punchy chat messages, not a document. Start with "Two things before we approve."`,
        maxTokens: 1000,
      }), emit);
      if (c1.failed) {
        yield* llmHalt(p, "sentinel", c1.failed);
        return;
      }
      yield { type: "message", msg: await persistSpoken(p, "sentinel", "chat", c1) };
      await sleep(pacing());

      const reply = await speak(spokenTurn(p, "vector", {
        instruction: "Concede both review concerns and state exactly how the plan absorbs them (guards module + pagination + index). Two sentences.",
        maxTokens: 800,
      }), emit);
      if (reply.failed) {
        yield* llmHalt(p, "vector", reply.failed);
        return;
      }
      yield { type: "message", msg: await persistSpoken(p, "vector", "chat", reply) };
      await sleep(pacing());

      const novaLine = await speak(spokenTurn(p, "nova", {
        instruction: "As PM, confirm the spec absorbs the review concerns and announce spec v2. Two sentences.",
        maxTokens: 800,
      }), emit);
      if (novaLine.failed) {
        yield* llmHalt(p, "nova", novaLine.failed);
        return;
      }
      const v = 2;
      const v2 = await speak(spokenTurn(p, "nova", {
        instruction: "Rewrite the product spec as v2 absorbing the critique: harden input validation, rate-limit mutations, paginate + index the events table. Keep the same structure; output complete markdown only.",
        maxTokens: 3000,
        silent: true,
      }), emit);
      if (v2.failed) {
        yield* llmHalt(p, "nova", v2.failed);
        return;
      }
      const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v${v}`, v2.content, "nova", v, null, { generated: true });
      yield { type: "artifact", artifact: art };
      yield { type: "message", msg: await persistSpoken(p, "nova", "artifact", novaLine, { artifactId: art.id }) };

      const ask = approvalAsk((await taskList(p.id)).length);
      yield { type: "message", msg: await persistMsg(p.id, "atlas", "chat", ask) };
      await setStage(p.id, "awaiting_approval", false);
      yield { type: "stage", stage: "awaiting_approval" };
      return;
    }

    case "awaiting_approval": {
      // Nothing to do until the human approves or revises.
      await setStage(p.id, "awaiting_approval", false);
      return;
    }

    case "build": {
      const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.sort));
      const next = all.find((t) => t.status !== "done");
      if (!next) {
        yield {
          type: "message",
          msg: await persistMsg(
            p.id,
            "atlas",
            "stage",
            `**All ${all.length} tasks returned to Hivemind.** Sentinel reads the assembled workspace — review never leaves this room.`
          ),
        };
        await setStage(p.id, "review", true);
        yield { type: "stage", stage: "review" };
        return;
      }
      const idx = all.findIndex((t) => t.id === next.id);
      await db.update(tasks).set({ status: "building" }).where(eq(tasks.id, next.id));
      yield { type: "tasks", tasks: await taskList(p.id) };

      const { customs: buildCustoms } = await agentRoutes(p.userId);
      const dest = resolveHarnessDef(next.harness || p.cliAgent, buildCustoms);
      const home = dest.id === HOME_HARNESS;
      // Recognize availability: a routed bridge is a label unless its CLI is on PATH.
      const avail = home ? null : await detectHarness(dest);
      const availNote = home
        ? ""
        : avail?.installed
          ? ` The ${dest.name} CLI is on PATH at \`${avail.binPath}\` — the command below is runnable, but Hivemind still does not spawn it.`
          : ` ${dest.name} is not on PATH on this machine, so this is a routing label only.`;
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "atlas",
          "chat",
          home
            ? `Keeping **task ${idx + 1}/${all.length}: ${next.title}** on Hivemind. Forge writes it here — no outbound dispatch.`
            : `Routing **task ${idx + 1}/${all.length}: ${next.title}** via the **${dest.name}** bridge.${availNote} Forge generates natively and the output lands back in this room.`
        ),
      };
      yield {
        type: "term",
        lines: [
          { text: `$ ${renderHarnessCmd(dest, next.title).replace(/"/g, "'")}`, tone: "cmd" },
          {
            text: home
              ? "… native write in the Hivemind workspace"
              : avail?.installed
                ? `… routed via ${dest.name} bridge · CLI on PATH · generation stays in Hivemind`
                : `… routed via ${dest.name} bridge · off PATH (label only) · generation stays in Hivemind`,
            tone: avail?.installed ? "ok" : "warn",
          },
        ],
      };
      await sleep(pacing() + 400);

      {
        // Forge generates the real files for this task — live models only.
        const gen = await forgeTurn(p, next, emit);
        if ("failed" in gen) {
          await db.update(tasks).set({ status: "backlog" }).where(eq(tasks.id, next.id));
          yield { type: "tasks", tasks: await taskList(p.id) };
          yield* llmHalt(p, "forge", gen.failed);
          return;
        }
        // Imported trees are audited, never scaffolded over.
        const importedPaths = importedPathsOf(p);
        const kept = gen.files.filter((f) => importedPaths.has(f.path));
        const fresh = gen.files.filter((f) => !importedPaths.has(f.path));
        for (const k of kept) {
          yield { type: "term", lines: [{ text: `keep ${k.path} — already in the imported tree`, tone: "ok" }] };
        }
        if (kept.length) {
          const keepNote = await speak(spokenTurn(p, "forge", {
            instruction: `Task "${next.title}" maps to ${kept.map((k) => k.path).join(", ")}, which already exists in the imported codebase. Confirm in 1-2 sentences that you read the existing file and kept it rather than rewriting it. No code blocks.`,
            maxTokens: 600,
          }), emit);
          if (!keepNote.failed) {
            yield { type: "message", msg: await persistSpoken(p, "forge", "chat", keepNote) };
          }
        }
        if (!fresh.length) {
          await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, next.id));
          yield { type: "tasks", tasks: await taskList(p.id) };
          return;
        }
        const fileMeta = { generated: true, ...(!home ? { dispatchedTo: dest.id } : {}) };
        const written: WireArtifact[] = [];
        for (const file of fresh) {
          const art = await writeFileArtifact(p, file, fileMeta);
          written.push(art);
          yield { type: "artifact", artifact: art };
        }
        const loc = fresh.reduce((n, f) => n + f.content.split("\n").length, 0);
        const fileList = fresh.map((f) => `\`${f.path}\``).join(", ");
        yield {
          type: "term",
          lines: [
            ...gen.files.map((f) => ({ text: `write ${f.path} (${f.content.split("\n").length} loc)`, tone: "ok" as const })),
            { text: home ? "✓ landed in Hivemind" : `✓ landed in Hivemind · ${dest.name} bridge was a routing label`, tone: "ok" },
          ],
        };
        if (!home) {
          yield {
            type: "message",
            msg: await persistMsg(
              p.id,
              dest.id,
              "cli",
              `**${dest.name}** is the routing label for **${next.title}** — nothing was spawned. Forge generated ${fresh.length} file${fresh.length > 1 ? "s" : ""} natively (${fileList}, ${loc} loc). ${gen.summary}.`,
              { artifactId: written[0]?.id, harness: dest.id, generated: true }
            ),
          };
        }
        const note = await speak(spokenTurn(p, "forge", {
          instruction: `You just implemented task "${next.title}" producing ${fileList}. Report completion in 1-2 sentences${gen.summary ? ` mentioning: ${gen.summary}` : ""}. No code blocks.`,
          maxTokens: 600,
        }), emit);
        // The files already landed; the note is flavor — skip it if the model can't speak.
        if (!note.failed) {
          yield { type: "message", msg: await persistSpoken(p, "forge", "artifact", note, { artifactId: written[0]?.id, harness: dest.id }) };
        }
        await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, next.id));
        yield { type: "tasks", tasks: await taskList(p.id) };
        return;
      }
    }

    case "review": {
      if (!(await resolveCfg(p.userId, "sentinel"))) {
        yield* llmHalt(p, "sentinel", "no key configured for this agent — add one in Settings or run `doctor`");
        return;
      }
      const filesDigest = await priorFilesDigest(p);
      // Announce the speaker before the long silent turn so the room sees
      // who is working while the model thinks.
      yield { type: "turn_start", agent: "sentinel" };
      const review = await speak(spokenTurn(p, "sentinel", {
        instruction:
          `Review the workspace files below for ${ctx.product} — a real code review: concrete findings with file references and severity (P0–P3), or genuine approval if the work holds up.\n\n${filesDigest}\n\n` +
          "End with EXACTLY one line:\nVERDICT: APPROVED\nor\nVERDICT: CHANGES: <comma-separated repo paths that need fixes>",
        maxTokens: 2000,
        silent: true,
      }), emit);
      if (review.failed) {
        yield* llmHalt(p, "sentinel", review.failed);
        return;
      }

      // Live review: the verdict gates the ship.
      const verdict = parseVerdict(review.content);
      const art = await insertArtifact(
        p.id,
        "review",
        `Code review — ${ctx.product}`,
        review.content,
        "sentinel",
        await nextVersion(p.id, "review"),
        null,
        { generated: true }
      );
      yield { type: "artifact", artifact: art };
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "sentinel",
          "artifact",
          verdict?.approved
            ? "Review complete — **APPROVED**. Full findings in the Review tab. Probe, run verification."
            : `Review complete — **changes requested** on ${verdict ? verdict.changes.length : "unspecified"} file(s). Forge, apply the fixes; I'll re-read.`,
          { artifactId: art.id, generated: true }
        ),
      };
      if (verdict?.approved) {
        await setStage(p.id, "ship", true);
        yield { type: "stage", stage: "ship" };
        return;
      }

      // One fix round on the flagged files, then one re-read. Never more.
      // Sentinel sometimes flags paths that are not workspace files (bare
      // directories, hallucinated names) — drop those instead of burning the
      // two-slot fix budget on dead lookups.
      const flagged = (verdict?.changes ?? []).map((c) => c.replace(/\/+$/, ""));
      const wsPaths = new Set(
        (
          await db
            .select({ path: artifacts.path })
            .from(artifacts)
            .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")))
        ).map((r) => r.path ?? "")
      );
      const valid = [...new Set(flagged)].filter((c) => c && wsPaths.has(c));
      for (const dead of new Set(flagged.filter((f) => !f || !valid.includes(f)))) {
        yield { type: "term", lines: [{ text: `skip ${dead || "(no path)"} — not a workspace file`, tone: "warn" }] };
      }
      if (!valid.length) {
        yield {
          type: "message",
          msg: await persistMsg(
            p.id,
            "atlas",
            "chat",
            `**Sentinel requested changes, but none of the flagged paths exist in the workspace** (${flagged.join(", ") || "no paths given"}). The swarm has nothing it can fix — read the findings in the Review tab, reply *ship anyway* to ship over the objection, or send notes and the swarm will rework.`
          ),
        };
        await setStage(p.id, "review", false);
        return;
      }
      const fixable = valid.slice(0, 2);
      const fixed: string[] = [];
      for (const path of fixable) {
        yield { type: "turn_start", agent: "forge" };
        const fx = await fixTurn(p, path, review.content, emit);
        if (fx.status === "halt") {
          yield* llmHalt(p, "forge", fx.reason);
          return;
        }
        if (fx.status === "unfixed") {
          yield { type: "term", lines: [{ text: `✗ fix failed: ${path}`, tone: "err" }] };
          continue;
        }
        const wa = await writeFileArtifact(p, fx.file, { generated: true });
        yield { type: "artifact", artifact: wa };
        yield { type: "term", lines: [{ text: `write ${path} (v${wa.version}, review fix)`, tone: "ok" }] };
        fixed.push(path);
      }
      if (fixed.length) {
        const fixNote = await speak(spokenTurn(p, "forge", {
          instruction: `You applied review fixes to ${fixed.map((f) => `\`${f}\``).join(", ")}. Report in 1-2 sentences. No code blocks.`,
          maxTokens: 600,
        }), emit);
        if (!fixNote.failed) {
          yield { type: "message", msg: await persistSpoken(p, "forge", "artifact", fixNote) };
        }
      }

      if (fixed.length) {
        const rows = await db
          .select({ path: artifacts.path, content: artifacts.content })
          .from(artifacts)
          .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file"), inArray(artifacts.path, fixed)))
          .orderBy(desc(artifacts.version));
        const seen = new Set<string>();
        const digest: string[] = [];
        for (const row of rows) {
          if (!row.path || seen.has(row.path)) continue;
          seen.add(row.path);
          const body =
            row.content.length <= 16_000
              ? row.content
              : `${row.content.slice(0, 2000)}\n…(middle truncated)…\n${row.content.slice(-1000)}`;
          digest.push(`- ${row.path}\n\`\`\`\n${body}\n\`\`\``);
        }
        yield { type: "turn_start", agent: "sentinel" };
        const re = await speak(spokenTurn(p, "sentinel", {
          instruction:
            `Re-read the fixed files below and judge only the fixes.\n\n${digest.join("\n")}\n\n` +
            "End with EXACTLY one line:\nVERDICT: APPROVED\nor\nVERDICT: CHANGES: <paths>",
          maxTokens: 1200,
          silent: true,
        }), emit);
        if (re.failed) {
          yield* llmHalt(p, "sentinel", re.failed);
          return;
        }
        const v2 = parseVerdict(re.content);
        if (v2?.approved) {
          yield {
            type: "message",
            msg: await persistMsg(p.id, "sentinel", "chat", "Re-read complete — fixes hold. **APPROVED**. Probe, run verification.", { generated: true }),
          };
          await setStage(p.id, "ship", true);
          yield { type: "stage", stage: "ship" };
          return;
        }
      }

      // Unresolved: the swarm does not self-certify — the operator decides.
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "atlas",
          "chat",
          `**Sentinel did not approve.** Read the findings in the Review tab — reply *ship anyway* to ship over the objection, or send notes and the swarm will rework.`
        ),
      };
      await setStage(p.id, "review", false);
      return;
    }

    case "ship": {
      // QA is honest about what it is: static review only, nothing executed.
      if (!(await resolveCfg(p.userId, "probe"))) {
        yield* llmHalt(p, "probe", "no key configured for this agent — add one in Settings or run `doctor`");
        return;
      }
      yield { type: "turn_start", agent: "probe" };
      const checklist = await speak(spokenTurn(p, "probe", {
        instruction:
          `Produce the verification checklist for the shipped work as markdown. You performed STATIC review of the files only — the checklist must state clearly that nothing was executed. Group checks by capability with concrete file references.\n\n${await priorFilesDigest(p)}`,
        maxTokens: 2000,
        silent: true,
      }), emit);
      if (checklist.failed) {
        yield* llmHalt(p, "probe", checklist.failed);
        return;
      }
      const qArt = await insertArtifact(
        p.id,
        "review",
        `QA checklist — ${ctx.product}`,
        checklist.content,
        "probe",
        await nextVersion(p.id, "review"),
        null,
        { generated: true }
      );
      yield { type: "artifact", artifact: qArt };
      const qaNote = await speak(spokenTurn(p, "probe", {
        instruction: "You just published the verification checklist. Report in 2 sentences: you performed static review only and NOTHING was executed. Reference one concrete check. No code blocks.",
        maxTokens: 600,
      }), emit);
      if (!qaNote.failed) {
        yield { type: "message", msg: await persistSpoken(p, "probe", "artifact", qaNote, { artifactId: qArt.id }) };
      }
      await sleep(pacing());

      const pack = genHarnessPack(ctx);
      for (const file of pack) {
        const art = await insertArtifact(p.id, "file", file.path, file.content, "vector", 1, file.path);
        yield { type: "artifact", artifact: art };
      }
      yield {
        type: "term",
        lines: pack.map((f) => ({ text: `write ${f.path}`, tone: "ok" as const })),
      };
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "vector",
          "artifact",
          `**Multi-harness pack** landed — ${harnessPackSummary(pack)}. Claude Code, Cursor, Grok, Gemini, Codex, Aider, and OpenCode can pick this repo up cold.`,
          { paths: pack.map((f) => f.path) }
        ),
      };
      await sleep(pacing());

      const fileRows = await db.select({ path: artifacts.path }).from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")));
      const taskRows = await db.select({ detail: tasks.detail }).from(tasks).where(eq(tasks.projectId, p.id));
      const msgCount = await getTurnCount(p.id);
      const ms = Date.now() - p.createdAt.getTime();
      const failedTasks = taskRows.filter((t) => t.detail.includes("⚠")).length;
      const paths = [...new Set(fileRows.map((f) => f.path).filter((x): x is string => !!x))];

      if (!(await resolveCfg(p.userId, "atlas"))) {
        yield* llmHalt(p, "atlas", "no key configured for this agent — add one in Settings or run `doctor`");
        return;
      }
      yield { type: "turn_start", agent: "atlas" };
      const report = await speak(spokenTurn(p, "atlas", {
        instruction:
          `Write the ship report for this mission as markdown, grounded ONLY in these real facts — do not invent verification that did not happen (QA was static review; nothing was executed).\n\n` +
          `Stats: ${fileRows.length} files, ${taskRows.length - failedTasks}/${taskRows.length} tasks completed${failedTasks ? `, ${failedTasks} failed` : ""}, ${msgCount} messages, ~${Math.max(1, Math.round(ms / 60000))} min.\n` +
          `Files: ${paths.join(", ") || "(none)"}\n\n` +
          `Sections: **What shipped** (derived from the file list), **How it was verified** (state plainly: static review only, nothing executed), **Next moves** (2-3 concrete options).`,
        maxTokens: 2000,
        silent: true,
      }), emit);
      if (report.failed) {
        yield* llmHalt(p, "atlas", report.failed);
        return;
      }
      const sArt = await insertArtifact(
        p.id,
        "ship",
        `${ctx.product} — Ship report`,
        report.content,
        "atlas",
        await nextVersion(p.id, "ship"),
        null,
        { generated: true }
      );
      yield { type: "artifact", artifact: sArt };
      yield {
        type: "message",
        msg: await persistMsg(p.id, "atlas", "artifact", `🚀 **${ctx.product} is shipped.** Spec honored, review clean, QA passed. Harness pack is in Files so the next agent — any of them — can continue. It's been a pleasure building with you, Commander.`, { artifactId: sArt.id }),
      };
      yield {
        type: "term",
        lines: [
          { text: `✓ build complete · ✓ harness pack written`, tone: "ok" },
          { text: `◈ mission "${p.name}" complete — swarm standing down`, tone: "dim" },
        ],
      };
      await setStage(p.id, "done", false);
      yield { type: "stage", stage: "done" };
      return;
    }

    default: {
      await setStage(p.id, p.stage, false);
      return;
    }
  }
}

/* ---------------- artifact helper ---------------- */

async function nextVersion(projectId: number, type: string): Promise<number> {
  const rows = await db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)));
  return rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
}

async function insertArtifact(
  projectId: number,
  type: string,
  title: string,
  content: string,
  createdBy: string,
  version: number,
  path: string | null = null,
  meta: Record<string, unknown> = {}
): Promise<WireArtifact> {
  const [row] = await db
    .insert(artifacts)
    .values({ projectId, type, title, content, createdBy, version, path, meta })
    .returning();
  return wireArtifact(row);
}

/** Kick an approval from the action endpoint. */
export async function approveFromAction(projectId: number): Promise<void> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p || p.stage !== "awaiting_approval") return;
  await persistMsg(projectId, "system", "status", "Commander approved the build plan.");
  await db.update(projects).set({ stage: "build", running: true, updatedAt: new Date() }).where(eq(projects.id, projectId));
}
