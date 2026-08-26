import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { runSwarm } from "@/lib/engine";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sawEnd = false;
      const send = (obj: unknown) => {
        if ((obj as { type?: string }).type === "end") sawEnd = true;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        for await (const ev of runSwarm(pid, user.id, req.signal)) {
          send(ev);
        }
      } catch (e) {
        send({ type: "term", lines: [{ text: `orchestrator fault: ${e instanceof Error ? e.message : e}`, tone: "err" }] });
      } finally {
        // runSwarm always ends with its own `end` event (running=true means
        // "reconnect to continue"); only close the loop if it died without one.
        if (!sawEnd) send({ type: "end", stage: "unknown", running: false, awaiting: false });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
