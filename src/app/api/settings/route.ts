import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  return NextResponse.json({ data: row?.data ?? {} });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  const merged = { ...(row?.data ?? {}), ...body };
  if (row) {
    await db.update(userSettings).set({ data: merged }).where(eq(userSettings.userId, user.id));
  } else {
    await db.insert(userSettings).values({ userId: user.id, data: merged });
  }
  return NextResponse.json({ data: merged });
}
