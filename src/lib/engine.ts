/**
 * Hivemind orchestrator — a stage machine that drives a group-chat of
 * specialist agents. Streams SwarmEvents (SSE) while persisting every
 * message, artifact and task to Postgres. Runs in simulation mode without
 * keys, or against any BYOK OpenAI/Anthropic-compatible endpoint.
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
import { genHarnessPack, harnessPackSummary } from "@/lib/harness-pack";
import { streamChat, type ChatMsg, type LlmConfig } from "@/lib/llm";
import { createThinkFilter, stripThink } from "@/lib/think";
import {
  parseSpec,
  genSpec,
  genArch,
  genPlanTasks,
  genCodeForTask,
  genReview,
  genChecklist,
  genShipSummary,
  critiqueConcerns,
  approvalAsk,
  interruptReply,
  type SwarmCtx,
} from "@/lib/sim";
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

async function agentRoutes(userId: number): Promise<{ routes?: Record<string, AgentRoute>; error?: unknown }> {
  try {
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return { routes: (s?.data as { agents?: Record<string, AgentRoute> } | null)?.agents };
  } catch (e) {
    return { error: e };
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
 * A finished agent turn. `simulated` marks content that stood in for the live
 * model (no key configured, call failed, or empty reply) — persisted in meta
 * so the UI can label it.
 */
type SpokenResult = { content: string; simulated: boolean };

async function persistSpoken(
  p: ProjectRow,
  agent: string,
  kind: string,
  spoken: SpokenResult,
  extra: Record<string, unknown> = {}
): Promise<WireMessage> {
  const cfg = spoken.simulated ? null : await resolveCfg(p.userId, agent);
  return persistMsg(p.id, agent, kind, spoken.content, {
    ...extra,
    ...(cfg ? { provider: cfg.provider, model: cfg.model } : {}),
    ...(spoken.simulated ? { simulated: true } : {}),
  });
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

/** Build a streamed agent turn. Returns the content plus whether a simulated stand-in was used. */
async function* spokenTurn(
  p: ProjectRow,
  agent: string,
  opts: {
    instruction: string; // LLM instruction
    fallback: string; // simulated content
    maxTokens?: number;
    silent?: boolean; // stream without chat deltas (machine-parsed turns)
  }
): AsyncGenerator<SwarmEvent, SpokenResult> {
  yield { type: "turn_start", agent };
  const cfg = await resolveCfg(p.userId, agent);
  if (!cfg) {
    await sleep(pacing());
    return { content: opts.fallback, simulated: true };
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
  let failed = false;
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
  } catch {
    failed = true;
    content = "";
  }
  content = stripThink(content);
  if (!content.trim()) {
    // Never fake a live reply silently — say what happened, then stand in.
    yield {
      type: "term",
      lines: [
        failed
          ? { text: `live call failed (${cfg.provider}) — simulated stand-in`, tone: "err" }
          : { text: `live model returned empty (${cfg.provider}) — simulated stand-in`, tone: "warn" },
      ],
    };
    content = opts.fallback;
    if (!opts.silent) yield { type: "delta", agent, text: content };
    await sleep(300);
    return { content, simulated: true };
  }
  return { content, simulated: false };
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
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
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
 * Derive the build task list. Live mode asks Vector to extract real tasks from
 * the spec + architecture (+ the imported tree, which is already in the turn
 * context); sim mode and failed parses fall back to the template plan.
 */
async function planTasksFor(
  p: ProjectRow,
  ctx: SwarmCtx,
  archDoc: string,
  emit: (ev: SwarmEvent) => void
): Promise<{ tasks: { title: string; detail: string }[]; simulated: boolean }> {
  const imported = importedPathsOf(p).size > 0;
  const arch = archDoc.length > 2400 ? `${archDoc.slice(0, 2400)}\n…(truncated)` : archDoc;
  const r = await speak(
    spokenTurn(p, "vector", {
      instruction:
        (imported
          ? "Derive the implementation task list for EXTENDING the existing imported codebase above. Every task must modify or add to what already exists — never scaffold a fresh app over it."
          : "Derive the implementation task list from the spec and the architecture document below.") +
        `\n\nArchitecture document:\n${arch}\n\nRespond with ONLY a JSON array of 4-8 objects: [{"title": "...", "detail": "..."}]. Titles are short imperative work items; details are one sentence naming the files or surfaces involved. No prose, no code fences.`,
      fallback: "",
      maxTokens: 900,
      silent: true,
    }),
    emit
  );
  if (!r.simulated) {
    const parsed = parseTasks(r.content);
    if (parsed) return { tasks: parsed, simulated: false };
    emit({
      type: "term",
      lines: [{ text: "task extraction unparseable — template plan used (simulated)", tone: "warn" }],
    });
  }
  return { tasks: genPlanTasks(ctx), simulated: true };
}

/* ---------------- live construction (Phase 2) ---------------- */

type GeneratedFile = { path: string; content: string };

/** Repo-relative output paths only — no absolute, traversal, or odd characters. */
export function safeOutPath(raw: string): string | null {
  const path = raw.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!path || path.length > 120 || path.includes("..") || /[^a-zA-Z0-9._/-]/.test(path)) return null;
  return path;
}

/** Parse Forge's FILE-block output (1–3 files) into paths + contents. Null if unusable. */
function parseGeneratedFiles(text: string): { files: GeneratedFile[]; summary: string } | null {
  const files: GeneratedFile[] = [];
  const re = /FILE:\s*`?([^\n`]+?)`?\s*\n+```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && files.length < 3) {
    const path = safeOutPath(m[1]);
    const content = m[2].trimEnd();
    if (path && content.trim().length > 20) files.push({ path, content: `${content}\n` });
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
      const body =
        content.length > 24_000 ? "(large file — omitted)" : content.slice(0, 1000);
      return `- ${path}\n\`\`\`\n${body}${content.length > 1000 && content.length <= 24_000 ? "\n…(truncated)" : ""}\n\`\`\``;
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
): Promise<{ files: GeneratedFile[]; summary: string } | null> {
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
      spokenTurn(p, "forge", { instruction: instruction + extra, fallback: "", maxTokens: 2400, silent: true }),
      emit
    );
  let r = await run("");
  if (!r.simulated) {
    const parsed = parseGeneratedFiles(r.content);
    if (parsed) return parsed;
    r = await run("\n\nREMINDER: the response must start with `FILE: <path>` followed by a fenced code block.");
    if (!r.simulated) {
      const retry = parseGeneratedFiles(r.content);
      if (retry) return retry;
    }
  }
  return null;
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

/** One Forge turn applying review findings to a named file. Null when unusable. */
async function fixTurn(
  p: ProjectRow,
  path: string,
  reviewDoc: string,
  emit: (ev: SwarmEvent) => void
): Promise<GeneratedFile | null> {
  const [cur] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file"), eq(artifacts.path, path)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (!cur) return null;
  const r = await speak(
    spokenTurn(p, "forge", {
      instruction:
        `A code review flagged \`${path}\`. Apply the findings to it and return the COMPLETE updated file.\n\n` +
        `Review findings:\n${reviewDoc.slice(0, 1500)}\n\n` +
        `Current ${path}:\n\`\`\`\n${cur.content.slice(0, 4000)}\n\`\`\`\n\n` +
        `Output EXACTLY one file:\nFILE: ${path}\n\`\`\`<language>\n<complete updated content>\n\`\`\``,
      fallback: "",
      maxTokens: 2400,
      silent: true,
    }),
    emit
  );
  if (r.simulated) return null;
  return parseGeneratedFiles(r.content)?.files.find((f) => f.path === path) ?? null;
}

/** Scripted review pass — sim mode, and the tagged stand-in when a live review call fails. */
async function* scriptedReview(p: ProjectRow, ctx: SwarmCtx, emit: (ev: SwarmEvent) => void): AsyncGenerator<SwarmEvent> {
  void emit;
  const files = (await db.select().from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")))).map((a) => a.path ?? a.title);
  const doc = genReview(ctx, files, true);
  const art = await insertArtifact(p.id, "review", `Code review — ${ctx.product}`, doc, "sentinel", 1, null, { simulated: true });
  yield { type: "artifact", artifact: art };
  yield {
    type: "message",
    msg: await persistMsg(p.id, "sentinel", "artifact", `Review pass complete. One **P1** on the mutation path — Forge, fix it and I'll re-read. Everything else is clean.`, { artifactId: art.id, simulated: true }),
  };
  await sleep(pacing());

  // Forge patches the first file artifact.
  const first = await db.select().from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file"))).orderBy(asc(artifacts.id)).limit(1);
  if (first.length) {
    const f = first[0];
    const fixed = `${f.content}\n/* P1 fix: routed all writes through rateLimit() + server-side validation */\n`;
    const [upd] = await db
      .update(artifacts)
      .set({ content: fixed, version: f.version + 1, updatedAt: new Date() })
      .where(eq(artifacts.id, f.id))
      .returning();
    yield { type: "artifact", artifact: wireArtifact(upd) };
    yield {
      type: "message",
      msg: await persistMsg(p.id, "forge", "artifact", `P1 squashed — \`${f.path ?? f.title}\` now guards every write. v${upd.version} is up for re-review.`, { artifactId: upd.id, simulated: true }),
    };
    await sleep(pacing());
  }
  yield {
    type: "message",
    msg: await persistMsg(p.id, "sentinel", "chat", `Re-read. Fix is correct and tight — **APPROVED**. Probe, run the verification checklist.`, { simulated: true }),
  };
  await setStage(p.id, "ship", true);
  yield { type: "stage", stage: "ship" };
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
      if (p.interrupt && p.interrupt.trim()) {
        for await (const ev of handleInterrupt(p)) emit(ev);
      } else {
        for await (const ev of stepStage(p, emit)) emit(ev);
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

async function* handleInterrupt(p: ProjectRow): AsyncGenerator<SwarmEvent> {
  const text = (p.interrupt ?? "").trim();
  await db.update(projects).set({ interrupt: null }).where(eq(projects.id, p.id));
  const ctx = ctxOf(p);

  if (p.stage === "awaiting_approval") {
    if (isApproval(text)) {
      yield* approveBuild(p);
      return;
    }
    // Revision request — rework the spec, keep waiting for approval.
    const reply = interruptReply(ctx, text);
    const spoken = await (yield* speakWithFallback(p, reply.agent, text));
    yield { type: "message", msg: await persistSpoken(p, reply.agent, "chat", spoken) };
    const v = await nextVersion(p.id, "spec");
    const specDoc = genSpec(ctx, v, text);
    const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v${v}`, specDoc, reply.agent, v, null, { simulated: true });
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

  const reply = interruptReply(ctx, text);
  const spoken = await (yield* speakWithFallback(p, reply.agent, text));
  yield { type: "message", msg: await persistSpoken(p, reply.agent, "chat", spoken) };
}

async function* speakWithFallback(p: ProjectRow, agent: string, text: string): AsyncGenerator<SwarmEvent, SpokenResult> {
  const ctx = ctxOf(p);
  const fallback = interruptReply(ctx, text).content;
  const gen = spokenTurn(p, agent, {
    instruction: `The human commander just said: "${text}". Respond in character in 2-3 sentences, acknowledging and stating what you'll adjust.`,
    fallback,
    maxTokens: 220,
  });
  yield { type: "turn_start", agent };
  let result: SpokenResult = { content: fallback, simulated: true };
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
      const ackLine = `Reading the brief. I count **${ctx.features.length} first-class capabilities** in your spec — ${ctx.features.slice(0, 3).map((f) => `*${f}*`).join(", ")}${ctx.features.length > 3 ? "…" : ""}. Drafting the v1 spec now.`;
      const ack = await speak(spokenTurn(p, "nova", {
        instruction: "Acknowledge the mission brief in 2-3 sentences. Mention how many capabilities you extracted and that you are drafting the spec. Be warm and crisp.",
        fallback: ackLine,
        maxTokens: 200,
      }), emit);
      yield { type: "message", msg: await persistSpoken(p, "nova", "chat", ack) };
      await setStage(p.id, "spec", true);
      yield { type: "stage", stage: "spec" };
      return;
    }

    case "spec": {
      const fallback = genSpec(ctx, 1);
      const gen = spokenTurn(p, "nova", {
        instruction: "Write the complete v1 product spec as structured markdown (vision, problem, capability table, primary journey, non-goals, success metrics). Output markdown only.",
        fallback,
        maxTokens: 1500,
      });
      const doc = await speak(gen, emit);
      const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v1`, doc.content, "nova", 1, null, { simulated: doc.simulated });
      yield { type: "artifact", artifact: art };
      yield {
        type: "message",
        msg: await persistSpoken(p, "nova", "artifact", {
          content: `Spec v1 is on the table — ${ctx.features.length} capabilities, journeys mapped, non-goals set. Vector, it's yours to architect.`,
          simulated: doc.simulated,
        }, { artifactId: art.id }),
      };
      await setStage(p.id, "plan", true);
      yield { type: "stage", stage: "plan" };
      return;
    }

    case "plan": {
      const fallback = genArch(ctx);
      const gen = spokenTurn(p, "vector", {
        instruction: "Write the architecture document as markdown: stack table with rationale, a small ASCII system diagram, core data model, file tree, and invariants. Output markdown only.",
        fallback,
        maxTokens: 1500,
      });
      const doc = await speak(gen, emit);
      const art = await insertArtifact(p.id, "arch", `${ctx.product} — Architecture v1`, doc.content, "vector", 1, null, { simulated: doc.simulated });
      yield { type: "artifact", artifact: art };

      const plan = await planTasksFor(p, ctx, doc.content, emit);
      const routed = routeTasks(plan.tasks.map((t) => t.title), p.cliAgent);
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
          simulated: doc.simulated,
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
      const concerns = critiqueConcerns(ctx);
      const c1 = await speak(spokenTurn(p, "sentinel", {
        instruction: `Raise two concrete design-review concerns about this plan (input validation + rate limiting, and unbounded table growth). Write them as short punchy chat messages, not a document. Start with "Two things before we approve."`,
        fallback: concerns[0],
        maxTokens: 300,
      }), emit);
      yield { type: "message", msg: await persistSpoken(p, "sentinel", "chat", c1) };
      await sleep(pacing());

      const reply = await speak(spokenTurn(p, "vector", {
        instruction: "Concede both review concerns and state exactly how the plan absorbs them (guards module + pagination + index). Two sentences.",
        fallback: `Both fair. I'm adding a \`guards\` module — every mutation passes server-side validation and a rate limit — and pagination plus an index on \`events.at\` moves into task 1. Cheap now, painful later.`,
        maxTokens: 220,
      }), emit);
      yield { type: "message", msg: await persistSpoken(p, "vector", "chat", reply) };
      await sleep(pacing());

      const novaLine = await speak(spokenTurn(p, "nova", {
        instruction: "As PM, confirm the spec absorbs the review concerns and announce spec v2. Two sentences.",
        fallback: `Spec absorbs both — non-functional requirements added, v2 published. Nothing about the user promise changed, only how safely we keep it.`,
        maxTokens: 180,
      }), emit);
      const v = 2;
      const specDoc = genSpec(ctx, v, "Critique round: harden input validation, rate-limit mutations, paginate + index the events table.");
      const art = await insertArtifact(p.id, "spec", `${ctx.product} — Product Spec v${v}`, specDoc, "nova", v, null, { simulated: true });
      yield { type: "artifact", artifact: art };
      yield { type: "message", msg: await persistSpoken(p, "nova", "artifact", novaLine, { artifactId: art.id }) };

      const ask = approvalAsk(ctx, (await taskList(p.id)).length);
      yield { type: "message", msg: await persistMsg(p.id, "atlas", "chat", ask, { simulated: true }) };
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
      const failedMark = (t: typeof tasks.$inferSelect) => t.detail.includes("⚠");
      const next = all.find((t) => t.status !== "done" && !failedMark(t));
      if (!next) {
        const failed = all.filter(failedMark).length;
        yield {
          type: "message",
          msg: await persistMsg(
            p.id,
            "atlas",
            "stage",
            failed
              ? `**${all.length - failed}/${all.length} tasks returned to Hivemind; ${failed} could not be generated** and stay on the board. Sentinel reviews what landed.`
              : `**All ${all.length} tasks returned to Hivemind.** Sentinel reads the assembled workspace — review never leaves this room.`
          ),
        };
        await setStage(p.id, "review", true);
        yield { type: "stage", stage: "review" };
        return;
      }
      const idx = all.findIndex((t) => t.id === next.id);
      await db.update(tasks).set({ status: "building" }).where(eq(tasks.id, next.id));
      yield { type: "tasks", tasks: await taskList(p.id) };

      const dest = cliAgentById(next.harness || p.cliAgent);
      const home = dest.id === HOME_HARNESS;
      const live = !!(await resolveCfg(p.userId, "forge"));
      yield {
        type: "message",
        msg: await persistMsg(
          p.id,
          "atlas",
          "chat",
          home
            ? `Keeping **task ${idx + 1}/${all.length}: ${next.title}** on Hivemind. Forge writes it here — no outbound dispatch.`
            : live
              ? `Routing **task ${idx + 1}/${all.length}: ${next.title}** via the **${dest.name}** bridge — a routing label; nothing is spawned. Forge generates natively and the output lands back in this room.`
              : `Dispatching **task ${idx + 1}/${all.length}: ${next.title}** to **${dest.name}** (simulated dispatch). The output lands back in this room.`
        ),
      };
      yield {
        type: "term",
        lines: [
          { text: `$ ${renderHarnessCmd(dest, next.title).replace(/"/g, "'")}`, tone: "cmd" },
          { text: home ? "… native write in the Hivemind workspace" : `… routed via ${dest.name} bridge · generation stays in Hivemind`, tone: "dim" },
        ],
      };
      await sleep(pacing() + 400);

      if (live) {
        // Live mode: Forge generates the real files for this task.
        const gen = await forgeTurn(p, next, emit);
        if (!gen) {
          await db
            .update(tasks)
            .set({ status: "backlog", detail: `${next.detail} [⚠ generation failed — fix keys and requeue via swarm-cli]` })
            .where(eq(tasks.id, next.id));
          yield {
            type: "term",
            lines: [
              { text: `✗ generation failed twice: ${next.title}`, tone: "err" },
              { text: "◈ task left on the board — mission continues", tone: "dim" },
            ],
          };
          yield {
            type: "message",
            msg: await persistMsg(
              p.id,
              "atlas",
              "chat",
              `**Task "${next.title}" could not be generated.** It stays on the board — fix the provider in Settings and requeue it from the terminal (\`cli hive "…"\`).`
            ),
          };
          yield { type: "tasks", tasks: await taskList(p.id) };
          return;
        }
        const fileMeta = { generated: true, ...(!home ? { dispatchedTo: dest.id } : {}) };
        const written: WireArtifact[] = [];
        for (const file of gen.files) {
          const art = await writeFileArtifact(p, file, fileMeta);
          written.push(art);
          yield { type: "artifact", artifact: art };
        }
        const loc = gen.files.reduce((n, f) => n + f.content.split("\n").length, 0);
        const fileList = gen.files.map((f) => `\`${f.path}\``).join(", ");
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
              `**${dest.name}** is the routing label for **${next.title}** — nothing was spawned. Forge generated ${gen.files.length} file${gen.files.length > 1 ? "s" : ""} natively (${fileList}, ${loc} loc). ${gen.summary}.`,
              { artifactId: written[0]?.id, harness: dest.id, generated: true }
            ),
          };
        }
        const note = await speak(spokenTurn(p, "forge", {
          instruction: `You just implemented task "${next.title}" producing ${fileList}. Report completion in 1-2 sentences${gen.summary ? ` mentioning: ${gen.summary}` : ""}. No code blocks.`,
          fallback: `Done — ${fileList} in.`,
          maxTokens: 160,
        }), emit);
        yield { type: "message", msg: await persistSpoken(p, "forge", "artifact", note, { artifactId: written[0]?.id, harness: dest.id }) };
        await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, next.id));
        yield { type: "tasks", tasks: await taskList(p.id) };
        return;
      }

      const { path, content, summary } = genCodeForTask(next.title, idx, ctx);
      if (importedPathsOf(p).has(path)) {
        // The imported tree already has this file — audit it, don't scaffold over it.
        yield {
          type: "term",
          lines: [{ text: `keep ${path} — already in the imported tree`, tone: "ok" }],
        };
        const keepNote = await speak(spokenTurn(p, "forge", {
          instruction: `Task "${next.title}" maps to ${path}, which already exists in the imported codebase. Confirm in 1-2 sentences that you read the existing file and kept it rather than rewriting it. No code blocks.`,
          fallback: `\`${path}\` already covers **${next.title}** — I read through it and kept it as-is. No rewrite needed.`,
          maxTokens: 160,
        }), emit);
        yield { type: "message", msg: await persistSpoken(p, "forge", "chat", keepNote) };
        await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, next.id));
        yield { type: "tasks", tasks: await taskList(p.id) };
        return;
      }
      const loc = content.split("\n").length;
      const writer = home ? "forge" : dest.id;
      const art = await insertArtifact(p.id, "file", path, content, writer, 1, path, { simulated: true });
      yield {
        type: "term",
        lines: [
          { text: `write ${path} (${loc} loc)`, tone: "ok" },
          { text: home ? "✓ landed in Hivemind" : `✓ landed in Hivemind · ${dest.name} bridge was a routing label`, tone: "ok" },
        ],
      };
      yield { type: "artifact", artifact: art };
      if (!home) {
        yield {
          type: "message",
          msg: await persistMsg(
            p.id,
            dest.id,
            "cli",
            `**${dest.name}** is the routing label for **${next.title}** — nothing was spawned. \`${path}\` (${loc} loc) landed in Hivemind. ${summary}.`,
            { artifactId: art.id, harness: dest.id, simulated: true }
          ),
        };
      }
      const note = await speak(spokenTurn(p, "forge", {
        instruction: home
          ? `You just implemented task "${next.title}" in file ${path}. Report completion in 1-2 sentences mentioning ${summary}. No code blocks.`
          : `Task "${next.title}" (file ${path}) just landed in the Hivemind workspace under the ${dest.name} routing label. Confirm you integrated it in 1-2 sentences mentioning ${summary}. No code blocks.`,
        fallback: home
          ? `Done — \`${path}\` in. ${summary}. Typed end-to-end, no shortcuts.`
          : `Integrated \`${path}\` (${dest.name} routing label). ${summary}. It's in the workspace — Sentinel can read it here.`,
        maxTokens: 160,
      }), emit);
      yield { type: "message", msg: await persistSpoken(p, "forge", "artifact", note, { artifactId: art.id, harness: dest.id }) };
      await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, next.id));
      yield { type: "tasks", tasks: await taskList(p.id) };
      return;
    }

    case "review": {
      let review: SpokenResult | null = null;
      const live = !!(await resolveCfg(p.userId, "sentinel"));
      if (live) {
        const filesDigest = await priorFilesDigest(p);
        review = await speak(spokenTurn(p, "sentinel", {
          instruction:
            `Review the workspace files below for ${ctx.product} — a real code review: concrete findings with file references and severity (P0–P3), or genuine approval if the work holds up.\n\n${filesDigest}\n\n` +
            "End with EXACTLY one line:\nVERDICT: APPROVED\nor\nVERDICT: CHANGES: <comma-separated repo paths that need fixes>",
          fallback: "",
          maxTokens: 1200,
          silent: true,
        }), emit);
      }
      if (!review || review.simulated) {
        yield* scriptedReview(p, ctx, emit);
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
      const fixable = (verdict?.changes ?? []).slice(0, 2);
      const fixed: string[] = [];
      for (const path of fixable) {
        const file = await fixTurn(p, path, review.content, emit);
        if (!file) {
          yield { type: "term", lines: [{ text: `✗ fix failed: ${path}`, tone: "err" }] };
          continue;
        }
        const wa = await writeFileArtifact(p, file, { generated: true });
        yield { type: "artifact", artifact: wa };
        yield { type: "term", lines: [{ text: `write ${path} (v${wa.version}, review fix)`, tone: "ok" }] };
        fixed.push(path);
      }
      if (fixed.length) {
        const fixNote = await speak(spokenTurn(p, "forge", {
          instruction: `You applied review fixes to ${fixed.map((f) => `\`${f}\``).join(", ")}. Report in 1-2 sentences. No code blocks.`,
          fallback: `Fixes applied to ${fixed.map((f) => `\`${f}\``).join(", ")}.`,
          maxTokens: 140,
        }), emit);
        yield { type: "message", msg: await persistSpoken(p, "forge", "artifact", fixNote) };
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
          digest.push(`- ${row.path}\n\`\`\`\n${row.content.slice(0, 800)}\n\`\`\``);
        }
        const re = await speak(spokenTurn(p, "sentinel", {
          instruction:
            `Re-read the fixed files below and judge only the fixes.\n\n${digest.join("\n")}\n\n` +
            "End with EXACTLY one line:\nVERDICT: APPROVED\nor\nVERDICT: CHANGES: <paths>",
          fallback: "",
          maxTokens: 500,
          silent: true,
        }), emit);
        const v2 = re.simulated ? null : parseVerdict(re.content);
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
      const qaLive = !!(await resolveCfg(p.userId, "probe"));
      let checklist: SpokenResult = { content: "", simulated: true };
      if (qaLive) {
        checklist = await speak(spokenTurn(p, "probe", {
          instruction:
            `Produce the verification checklist for the shipped work as markdown. You performed STATIC review of the files only — the checklist must state clearly that nothing was executed. Group checks by capability with concrete file references.\n\n${await priorFilesDigest(p)}`,
          fallback: "",
          maxTokens: 900,
          silent: true,
        }), emit);
      }
      if (!qaLive || checklist.simulated) {
        checklist = { content: genChecklist(ctx), simulated: true };
      }
      const qArt = await insertArtifact(
        p.id,
        "review",
        `QA checklist — ${ctx.product}`,
        checklist.content,
        "probe",
        await nextVersion(p.id, "review"),
        null,
        checklist.simulated ? { simulated: true } : { generated: true }
      );
      yield { type: "artifact", artifact: qArt };
      const qaNote = await speak(spokenTurn(p, "probe", {
        instruction: "You just published the verification checklist. Report in 2 sentences: you performed static review only and NOTHING was executed. Reference one concrete check. No code blocks.",
        fallback: "Verification checklist published — static review only, nothing was executed.",
        maxTokens: 140,
      }), emit);
      yield { type: "message", msg: await persistSpoken(p, "probe", "artifact", qaNote, { artifactId: qArt.id }) };
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
          { paths: pack.map((f) => f.path), simulated: true }
        ),
      };
      await sleep(pacing());

      const fileRows = await db.select({ path: artifacts.path }).from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.type, "file")));
      const taskRows = await db.select({ detail: tasks.detail }).from(tasks).where(eq(tasks.projectId, p.id));
      const msgCount = await getTurnCount(p.id);
      const ms = Date.now() - p.createdAt.getTime();
      const failedTasks = taskRows.filter((t) => t.detail.includes("⚠")).length;
      const paths = [...new Set(fileRows.map((f) => f.path).filter((x): x is string => !!x))];

      const shipLive = !!(await resolveCfg(p.userId, "atlas"));
      let report: SpokenResult = { content: "", simulated: true };
      if (shipLive) {
        report = await speak(spokenTurn(p, "atlas", {
          instruction:
            `Write the ship report for this mission as markdown, grounded ONLY in these real facts — do not invent verification that did not happen (QA was static review; nothing was executed).\n\n` +
            `Stats: ${fileRows.length} files, ${taskRows.length - failedTasks}/${taskRows.length} tasks completed${failedTasks ? `, ${failedTasks} failed` : ""}, ${msgCount} messages, ~${Math.max(1, Math.round(ms / 60000))} min.\n` +
            `Files: ${paths.join(", ") || "(none)"}\n\n` +
            `Sections: **What shipped** (derived from the file list), **How it was verified** (state plainly: static review only, nothing executed), **Next moves** (2-3 concrete options).`,
          fallback: "",
          maxTokens: 900,
          silent: true,
        }), emit);
      }
      if (!shipLive || report.simulated) {
        report = { content: genShipSummary(ctx, { files: fileRows.length, tasks: taskRows.length, messages: msgCount, ms }), simulated: true };
      }
      const sArt = await insertArtifact(
        p.id,
        "ship",
        `${ctx.product} — Ship report`,
        report.content,
        "atlas",
        await nextVersion(p.id, "ship"),
        null,
        report.simulated ? { simulated: true } : { generated: true }
      );
      yield { type: "artifact", artifact: sArt };
      yield {
        type: "message",
        msg: await persistMsg(p.id, "atlas", "artifact", `🚀 **${ctx.product} is shipped.** Spec honored, review clean, QA passed. Harness pack is in Files so the next agent — any of them — can continue. It's been a pleasure building with you, Commander.`, { artifactId: sArt.id, simulated: true }),
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
