import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, messages } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const [row] = await db
    .insert(messages)
    .values({ projectId: pid, author: "user", kind: "chat", content, meta: {} })
    .returning();

  // The orchestrator picks the interrupt up on its next beat.
  const shouldWake = p.stage !== "done";
  await db
    .update(projects)
    .set({
      interrupt: content,
      running: shouldWake ? true : p.running,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, pid));

  return NextResponse.json({
    message: {
      id: row.id,
      author: row.author,
      kind: row.kind,
      content: row.content,
      meta: row.meta ?? {},
      createdAt: row.createdAt.toISOString(),
    },
    wake: shouldWake,
  });
}
