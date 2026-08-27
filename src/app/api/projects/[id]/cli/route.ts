import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, messages, tasks, artifacts, apiKeys } from "@/db/schema";
import { asc, and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { AGENTS, HARNESSES, harnessById, isHarnessId, renderHarnessCmd } from "@/lib/agents";
import { detectHarness, detectHarnesses } from "@/lib/detect-harness";
import { HOME_HARNESS, routeTasks } from "@/lib/harness-route";
import { runDoctor } from "@/lib/doctor";
import type { TermLine } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * swarm-cli bridge — the built-in terminal speaks to the same orchestrator
 * state, and can impersonate the user's preferred external coding harness.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const raw = String(body?.command ?? "").trim();
  const [cmd, ...rest] = raw.split(/\s+/);
  const lines: TermLine[] = [];
  const say = (text: string, tone?: TermLine["tone"]) => lines.push({ text, tone });
  let cliAgent = p.cliAgent;
  let wake = false;

  switch ((cmd ?? "").toLowerCase()) {
    case "help":
    case "":
      say("swarm-cli — hivemind multi-harness bridge", "ok");
      say("  help                 this help");
      say("  status               mission state, stage, progress");
      say("  doctor               diagnose + fix whatever blocks live runs");
      say("  agents               list the swarm roster");
      say("  harness              list coding-agent bridges + PATH");
      say("  harness use <id>     switch this mission's execution bridge");
      say("  plan                 show the task board");
      say("  files                list generated files");
      say("  banner               print the startup banner");
      say(`  cli <id> "…"         hive: queue a task on the board · others: print the host command`);
      break;

    case "banner":
      say("┌─────────────────────────────────────────────┐", "dim");
      say("│  HIVEMIND · multi-agent build swarm  ◈      │", "ok");
      say("│  one spec in → a shipped app out            │", "dim");
      say("│  multi-harness · claude cursor grok gemini  │", "dim");
      say("└─────────────────────────────────────────────┘", "dim");
      break;

    case "status": {
      const tks = await db.select().from(tasks).where(eq(tasks.projectId, pid));
      const done = tks.filter((t) => t.status === "done").length;
      const keys = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
      const bridge = harnessById(p.cliAgent);
      const det = await detectHarness(bridge);
      say(`mission     ${p.name}`, "ok");
      say(`stage       ${p.stage}${p.running ? "  (swarm active)" : ""}`);
      say(`tasks       ${done}/${tks.length} complete`);
      say(`engine      ${keys.length ? "BYOK — live models only" : "offline — add a key in Settings or run doctor"}`);
      say(
        `cli bridge  ${bridge.name}${det.installed ? (bridge.bin ? `  (on PATH: ${det.binPath})` : "  (in-process)") : "  (not on PATH — template only)"}`
      );
      break;
    }

    case "doctor": {
      const report = await runDoctor(user.id);
      for (const l of report) say(l.text, l.tone);
      break;
    }

    case "agents":
      for (const a of AGENTS) say(`${a.glyph}  ${a.name.padEnd(9)} ${a.role.padEnd(16)} ${a.blurb}`, "dim");
      break;

    case "harness":
    case "harnesses": {
      const sub = (rest[0] ?? "").toLowerCase();
      if (sub === "use" || sub === "set" || sub === "switch") {
        const nextId = (rest[1] ?? "").toLowerCase();
        if (!isHarnessId(nextId)) {
          say(`usage: harness use <${HARNESSES.map((h) => h.id).join("|")}>`, "err");
          break;
        }
        const next = harnessById(nextId);
        await db.update(projects).set({ cliAgent: next.id, updatedAt: new Date() }).where(eq(projects.id, pid));
        cliAgent = next.id;
        const det = await detectHarness(next);
        say(`bridge switched → ${next.name}`, "ok");
        say(`$ ${next.template}`, "cmd");
        say(
          det.installed
            ? next.bin
              ? `✓ ${next.bin} on PATH at ${det.binPath}`
              : "✓ native in-process bridge"
            : `◌ ${next.bin} not on PATH — Forge will still run in-process and print this command for self-hosters`,
          det.installed ? "ok" : "warn"
        );
        await db.insert(messages).values({
          projectId: pid,
          author: "system",
          kind: "status",
          content: `Execution bridge set to **${next.name}**.`,
          meta: { cliAgent: next.id },
        });
        break;
      }
      const rows = await detectHarnesses();
      say("coding-agent harnesses", "ok");
      for (const h of rows) {
        const mark = h.id === p.cliAgent ? "*" : " ";
        const state = h.installed ? (h.bin ? "on PATH" : "native") : "off PATH";
        const tone: TermLine["tone"] = h.id === p.cliAgent ? "ok" : h.installed ? undefined : "dim";
        say(`${mark} ${h.id.padEnd(12)} ${h.name.padEnd(18)} ${state}`, tone);
      }
      say("active marked with * ·  harness use <id>  to switch", "dim");
      break;
    }

    case "plan": {
      const tks = await db.select().from(tasks).where(eq(tasks.projectId, pid)).orderBy(asc(tasks.sort));
      if (!tks.length) say("no plan yet — the swarm drafts one during the Plan stage", "warn");
      for (const t of tks) {
        const mark = t.status === "done" ? "✓" : t.status === "building" ? "▶" : "·";
        say(` ${mark} [${t.status.padEnd(8)}] ${t.title}`, t.status === "done" ? "ok" : undefined);
      }
      break;
    }

    case "files": {
      const fs = await db.select().from(artifacts).where(and(eq(artifacts.projectId, pid), eq(artifacts.type, "file")));
      if (!fs.length) say("no files written yet", "warn");
      for (const f of fs) say(` ${f.path ?? f.title}  (v${f.version}, ${f.content.split("\n").length} loc)`, "ok");
      break;
    }

    case "cli": {
      const agentId = (rest[0] ?? "").toLowerCase();
      const task = rest.slice(1).join(" ").replace(/^["']|["']$/g, "");
      if (!isHarnessId(agentId) || !task) {
        say(`usage: cli <${HARNESSES.map((c) => c.id).join("|")}> "task description"`, "err");
        break;
      }
      const agent = harnessById(agentId);
      const det = await detectHarness(agent);
      say(`$ ${renderHarnessCmd(agent, task)}`, "cmd");
      if (agent.id === "hive") {
        // The native bridge is in-product: queue the task on the board and wake the swarm.
        const existing = await db.select({ id: tasks.id, sort: tasks.sort }).from(tasks).where(eq(tasks.projectId, pid));
        const sort = existing.reduce((m, t) => Math.max(m, t.sort), -1) + 1;
        const routed = routeTasks([task], p.cliAgent)[0] ?? HOME_HARNESS;
        await db.insert(tasks).values({
          projectId: pid,
          title: task.slice(0, 120),
          detail: "Queued from swarm-cli by the Commander.",
          assignee: "forge",
          harness: routed,
          status: "backlog",
          sort,
        });
        const reopened = p.stage === "done";
        await db
          .update(projects)
          .set({
            stage: reopened ? "build" : p.stage,
            running: true,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, pid));
        await db.insert(messages).values({
          projectId: pid,
          author: "system",
          kind: "status",
          content: `Task queued from swarm-cli: "${task.slice(0, 120)}"`,
          meta: {},
        });
        say(`✓ task queued — #${existing.length + 1} on the board · routed to ${harnessById(routed).name}`, "ok");
        if (reopened) say("mission reopened at build — the shipped output continues", "warn");
        say("◈ swarm waking — watch the chat", "dim");
        wake = true;
      } else if (det.installed && agent.bin) {
        say(`${agent.bin} is on PATH in this process. Hivemind still does not spawn it. Run the command above yourself.`, "warn");
      } else {
        say(`${agent.bin ?? agent.id} is not on PATH here. Hivemind does not spawn external CLIs.`, "warn");
      }
      break;
    }

    default:
      say(`unknown command: ${cmd ?? "(empty)"} — try 'help'`, "err");
  }

  return NextResponse.json({ lines, cliAgent, wake });
}
