import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { approveFromAction } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const type = String(body?.type ?? "");

  if (type === "approve") {
    await approveFromAction(pid);
    return NextResponse.json({ ok: true, stage: "build" });
  }
  if (type === "pause") {
    await db.update(projects).set({ running: false, updatedAt: new Date() }).where(eq(projects.id, pid));
    return NextResponse.json({ ok: true, stage: p.stage });
  }
  if (type === "run") {
    if (p.stage === "done") return NextResponse.json({ ok: false, error: "already shipped" });
    await db.update(projects).set({ running: true, updatedAt: new Date() }).where(eq(projects.id, pid));
    return NextResponse.json({ ok: true, stage: p.stage });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
