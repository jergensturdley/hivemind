import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { startCodexDevice } from "@/lib/codex-oauth";
import { rememberDevice } from "@/lib/oauth-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const device = await startCodexDevice();
    await rememberDevice("codex", user.id, device.device_code, device.expires_in);
    return NextResponse.json({
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      device_code: device.device_code,
      interval: device.interval,
      expires_in: device.expires_in,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
