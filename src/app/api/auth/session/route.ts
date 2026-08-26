import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, userSettings, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sessionCookieValue } from "@/lib/session";

export const runtime = "nodejs";

const EXAMPLE_SPEC = `Lumen Board — a lightweight team analytics app for small squads.

It should:
- Track weekly focus goals per teammate (one line of text each Monday)
- Show a live squad pulse: who's heads-down, who's free for pairing
- Render a burn-down of open work items synced from a simple checklist
- Post a Friday digest summarizing what shipped and what slipped
- Keep everything keyboard-first and blazing fast

Keep it opinionated, single-screen where possible, dark theme.`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email so this machine can find you again." }, { status: 400 });
  }

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let isNew = false;
  if (!user) {
    isNew = true;
    const hue = Math.abs([...email].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 360;
    [user] = await db.insert(users).values({ email, name, hue }).returning();
    await db.insert(userSettings).values({ userId: user.id, data: { cliAgent: "hive", agents: {} } });
    await db.insert(projects).values({
      userId: user.id,
      name: "Lumen Board",
      spec: EXAMPLE_SPEC,
      stage: "intake",
      cliAgent: "hive",
      ctx: { fixture: true },
    });
  }

  const cookie = sessionCookieValue(user.id);
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, hue: user.hue },
    isNew,
  });
  res.cookies.set(cookie.name, cookie.value, { maxAge: cookie.maxAge, path: "/", httpOnly: true, sameSite: "lax" });
  return res;
}
