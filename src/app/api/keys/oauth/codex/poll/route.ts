import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { CODEX_OAUTH, pollCodexDevice } from "@/lib/codex-oauth";
import { forgetDevice, hasDevice } from "@/lib/oauth-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { device_code?: string; user_code?: string } | null;
  const deviceCode = String(body?.device_code ?? "");
  const userCode = String(body?.user_code ?? "");
  if (!deviceCode || !userCode || !(await hasDevice("codex", user.id, deviceCode))) {
    return NextResponse.json({ status: "error", error: "unknown or expired device login" }, { status: 400 });
  }

  const result = await pollCodexDevice(deviceCode, userCode);
  if (result.status !== "ok") return NextResponse.json(result);

  await forgetDevice("codex", user.id);

  await db.update(apiKeys).set({ isDefault: false }).where(eq(apiKeys.userId, user.id));
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      provider: "codex",
      label: "Codex (ChatGPT)",
      baseUrl: CODEX_OAUTH.apiBase,
      model: "",
      secret: result.tokens.access_token,
      authKind: "oauth",
      refreshToken: result.tokens.refresh_token,
      tokenExpiresAt: result.tokens.expires_in
        ? new Date(Date.now() + result.tokens.expires_in * 1000)
        : null,
      isDefault: true,
    })
    .returning();

  return NextResponse.json({ status: "ok", id: row.id });
}
