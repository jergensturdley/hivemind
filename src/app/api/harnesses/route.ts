import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { detectHarnesses } from "@/lib/detect-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const harnesses = await detectHarnesses();
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
      installed: h.installed,
      binPath: h.binPath,
    })),
  });
}
