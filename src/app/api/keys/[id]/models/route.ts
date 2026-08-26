import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { listModels, rankModels, recommendModel } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .limit(1);
  if (!key) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const { cfgFromKey } = await import("@/lib/key-auth");
    const cfg = await cfgFromKey(key);
    const models = await listModels({
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      secret: cfg.secret,
    });
    const ranked = rankModels(key.provider, models);
    return NextResponse.json({
      provider: key.provider,
      models,
      chat: ranked.chat,
      other: ranked.other,
      recommended: recommendModel(key.provider, models),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
