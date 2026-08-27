import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { detectAll } from "@/lib/detect-harness";
import { customHarnessesOf } from "@/lib/harnesses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  const harnesses = await detectAll(customHarnessesOf(s?.data));
  return NextResponse.json({
    harnesses: harnesses.map((h) => ({
      id: h.id,
      name: h.name,
      vendor: h.vendor,
      glyph: h.glyph,
      hue: h.hue,
      desc: h.desc,
      template: h.template,
      bin: h.bin,
      guidance: h.guidance,
      custom: h.custom === true,
      installed: h.installed,
      binPath: h.binPath,
    })),
  });
}
