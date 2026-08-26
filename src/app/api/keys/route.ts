import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

const mask = (s: string) => (s.length <= 8 ? "••••" : `${s.slice(0, 4)}…${s.slice(-4)}`);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
  return NextResponse.json({
    keys: rows.map((k) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      baseUrl: k.baseUrl,
      model: k.model,
      secretMasked: mask(k.secret),
      authKind: k.authKind,
      isDefault: k.isDefault,
      createdAt: k.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const provider = String(body?.provider ?? "openai");
  const model = String(body?.model ?? "").trim();
  const secret = String(body?.secret ?? "").trim();
  if (!secret) {
    return NextResponse.json({ error: "API key is required." }, { status: 400 });
  }
  if (provider === "custom" && !String(body?.baseUrl ?? "").trim()) {
    return NextResponse.json({ error: "Base URL is required for a custom endpoint." }, { status: 400 });
  }
  const isDefault = !!body?.isDefault || (await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, user.id))).length === 0;
  if (isDefault) {
    await db.update(apiKeys).set({ isDefault: false }).where(eq(apiKeys.userId, user.id));
  }
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      provider,
      label: String(body?.label ?? "").trim() || `${provider} key`,
      baseUrl: body?.baseUrl ? String(body.baseUrl).trim() : null,
      model,
      secret,
      isDefault,
    })
    .returning();
  return NextResponse.json({ id: row.id, isDefault, model: row.model });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const [existing] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Partial<typeof apiKeys.$inferInsert> = {};
  if (typeof body?.model === "string") patch.model = body.model.trim();
  if (typeof body?.label === "string") patch.label = body.label.trim() || existing.label;
  if (typeof body?.isDefault === "boolean") patch.isDefault = body.isDefault;

  if (patch.isDefault) {
    await db.update(apiKeys).set({ isDefault: false }).where(eq(apiKeys.userId, user.id));
  }

  const [row] = await db
    .update(apiKeys)
    .set(patch)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .returning();
  return NextResponse.json({
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.baseUrl,
    model: row.model,
    isDefault: row.isDefault,
  });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)));
  return NextResponse.json({ ok: true });
}
