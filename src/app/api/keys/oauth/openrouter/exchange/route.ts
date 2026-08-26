import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { code?: string; code_verifier?: string } | null;
  const code = String(body?.code ?? "").trim();
  const verifier = String(body?.code_verifier ?? "").trim();
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier || undefined,
      code_challenge_method: verifier ? "S256" : undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { key?: string; error?: { message?: string } | string };
  const key = json.key;
  if (!res.ok || !key) {
    const msg = typeof json.error === "string" ? json.error : json.error?.message || `OpenRouter OAuth failed (${res.status})`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await db.update(apiKeys).set({ isDefault: false }).where(eq(apiKeys.userId, user.id));
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      provider: "openrouter",
      label: "OpenRouter (OAuth)",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "",
      secret: key,
      authKind: "oauth",
      isDefault: true,
    })
    .returning();

  return NextResponse.json({ id: row.id });
}
