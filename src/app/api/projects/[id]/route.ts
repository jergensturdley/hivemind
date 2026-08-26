import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, messages, artifacts, tasks, apiKeys } from "@/db/schema";
import { asc, and, eq, ne } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [msgs, arts, tks] = await Promise.all([
    db.select().from(messages).where(eq(messages.projectId, pid)).orderBy(asc(messages.id)),
    db.select().from(artifacts).where(eq(artifacts.projectId, pid)).orderBy(asc(artifacts.id)),
    db.select().from(tasks).where(eq(tasks.projectId, pid)).orderBy(asc(tasks.sort)),
  ]);
  const keys = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), ne(apiKeys.model, "")))
    .limit(1);

  return NextResponse.json({
    project: {
      id: p.id,
      name: p.name,
      spec: p.spec,
      stage: p.stage,
      running: p.running,
      cliAgent: p.cliAgent,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    },
    keysConfigured: keys.length > 0,
    messages: msgs.map((m) => ({
      id: m.id,
      author: m.author,
      kind: m.kind,
      content: m.content,
      meta: m.meta ?? {},
      createdAt: m.createdAt.toISOString(),
    })),
    artifacts: arts.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      path: a.path,
      content: a.content,
      version: a.version,
      createdBy: a.createdBy,
      meta: a.meta ?? {},
      createdAt: a.createdAt.toISOString(),
    })),
    tasks: tks.map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.detail,
      assignee: t.assignee,
      harness: t.harness,
      status: t.status,
      sort: t.sort,
    })),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  await db.delete(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id)));
  return NextResponse.json({ ok: true });
}
