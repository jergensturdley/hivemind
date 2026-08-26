import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pingModel, type LlmConfig } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  let cfg: LlmConfig;
  const keyId = Number(body?.keyId);
  if (keyId) {
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, user.id)))
      .limit(1);
    if (!key) return NextResponse.json({ ok: false, error: "Key not found." }, { status: 404 });
    const { cfgFromKey } = await import("@/lib/key-auth");
    cfg = await cfgFromKey(key, String(body?.model ?? key.model));
  } else {
    cfg = {
      provider: String(body?.provider ?? "openai"),
      baseUrl: String(body?.baseUrl ?? ""),
      model: String(body?.model ?? ""),
      secret: String(body?.secret ?? ""),
    };
  }
  if (!cfg.model || !cfg.secret) {
    return NextResponse.json({ ok: false, error: "Model and key required." }, { status: 400 });
  }
  const reply = await pingModel(cfg);
  const ok = !reply.startsWith("error:");
  return NextResponse.json({ ok, reply: reply.slice(0, 300) });
}
