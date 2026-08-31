import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pollXaiDevice, XAI_OAUTH } from "@/lib/xai-oauth";
import { forgetDevice, hasDevice } from "@/lib/oauth-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { device_code?: string } | null;
  const deviceCode = String(body?.device_code ?? "");
  if (!deviceCode || !(await hasDevice("xai", user.id, deviceCode))) {
    return NextResponse.json({ status: "error", error: "unknown or expired device login" }, { status: 400 });
  }

  const result = await pollXaiDevice(deviceCode);
  if (result.status !== "ok") return NextResponse.json(result);

  await forgetDevice("xai", user.id);
  const expires = result.tokens.expires_in
    ? new Date(Date.now() + result.tokens.expires_in * 1000)
    : new Date(Date.now() + 3600_000);

  // The default key is a user choice (Settings "Use as default"); a new key
  // only claims it when it is the account's first.
  const isFirst = !((await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, user.id))).length);
  if (isFirst) {
    await db.update(apiKeys).set({ isDefault: false }).where(eq(apiKeys.userId, user.id));
  }
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      provider: "xai",
      label: "Grok (OAuth)",
      baseUrl: XAI_OAUTH.apiBase,
      model: "",
      secret: result.tokens.access_token,
      authKind: "oauth",
      refreshToken: result.tokens.refresh_token ?? null,
      tokenExpiresAt: expires,
      isDefault: isFirst,
    })
    .returning();

  return NextResponse.json({ status: "ok", id: row.id });
}
