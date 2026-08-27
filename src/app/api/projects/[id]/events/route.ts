import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { runSwarm } from "@/lib/engine";
import type { SwarmEvent } from "@/lib/events";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

/**
 * Interleave SSE comment frames with engine events. Long silent turns (big
 * reasoning models generating code) leave the stream quiet for minutes;
 * intermediate layers drop connections they consider dead, aborting the run
 * mid-turn. Yields `null` where the route should write a keep-alive frame.
 */
async function* streamWithKeepAlive(
  events: AsyncGenerator<SwarmEvent>
): AsyncGenerator<SwarmEvent | null> {
  const pending: SwarmEvent[] = [];
  let done = false;
  const wake: { fn?: () => void } = {};
  const pump = (async () => {
    try {
      for await (const ev of events) {
        pending.push(ev);
        wake.fn?.();
      }
    } catch (e) {
      pending.push({
        type: "term",
        lines: [{ text: `orchestrator fault: ${e instanceof Error ? e.message : String(e)}`, tone: "err" }],
      });
    } finally {
      done = true;
      wake.fn?.();
    }
  })();
  for (;;) {
    if (pending.length) {
      yield pending.shift()!;
      continue;
    }
    if (done) break;
    await Promise.race([
      new Promise<void>((r) => {
        wake.fn = r;
      }),
      new Promise<void>((r) => setTimeout(r, KEEPALIVE_MS)),
    ]);
    wake.fn = undefined;
    if (!pending.length && !done) yield null;
  }
  await pump;
}

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
        for await (const ev of streamWithKeepAlive(runSwarm(pid, user.id, req.signal))) {
          if (ev === null) {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              /* closed */
            }
            continue;
          }
          send(ev);
        }
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
