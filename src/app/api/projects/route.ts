import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, messages, tasks, artifacts, apiKeys } from "@/db/schema";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { harnessById } from "@/lib/harnesses";
import { sanitizeImportFiles, type ImportFile } from "@/lib/import-folder";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(projects).where(eq(projects.userId, user.id)).orderBy(desc(projects.updatedAt));
  const ids = rows.map((p) => p.id);
  const toMap = (tallies: { id: number; n: number }[]) => {
    const map = new Map<number, number>();
    for (const t of tallies) map.set(t.id, Number(t.n));
    return map;
  };
  const empty: { id: number; n: number }[] = [];
  const [msgN, taskN, fileN] = ids.length
    ? await Promise.all([
        db
          .select({ id: messages.projectId, n: count() })
          .from(messages)
          .where(inArray(messages.projectId, ids))
          .groupBy(messages.projectId)
          .then(toMap),
        db
          .select({ id: tasks.projectId, n: count() })
          .from(tasks)
          .where(inArray(tasks.projectId, ids))
          .groupBy(tasks.projectId)
          .then(toMap),
        db
          .select({ id: artifacts.projectId, n: count() })
          .from(artifacts)
          .where(and(inArray(artifacts.projectId, ids), eq(artifacts.type, "file")))
          .groupBy(artifacts.projectId)
          .then(toMap),
      ])
    : [toMap(empty), toMap(empty), toMap(empty)];
  const list = rows.map((p) => ({
    id: p.id,
    name: p.name,
    spec: p.spec.slice(0, 220),
    stage: p.stage,
    running: p.running,
    cliAgent: p.cliAgent,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    fixture: (p.ctx as { fixture?: boolean } | null)?.fixture === true,
    counts: {
      messages: msgN.get(p.id) ?? 0,
      tasks: taskN.get(p.id) ?? 0,
      files: fileN.get(p.id) ?? 0,
    },
  }));
  const keys = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), ne(apiKeys.model, "")))
    .limit(1);
  return NextResponse.json({ projects: list, keysConfigured: keys.length > 0 });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const spec = String(body?.spec ?? "").trim();
  if (spec.length < 20) {
    return NextResponse.json({ error: "Give the swarm at least a sentence of intent." }, { status: 400 });
  }
  const name = String(body?.name ?? "").trim() || spec.split(/\s+/).slice(0, 3).join(" ");
  const incoming = Array.isArray(body?.files) ? (body.files as ImportFile[]) : [];
  const { files } = sanitizeImportFiles(incoming);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
        userId: user.id,
        name: name.slice(0, 60),
        spec,
        stage: "intake",
        cliAgent: harnessById(String(body?.cliAgent ?? "hive")).id,
        ctx: files.length ? { imported: true, importedFiles: files.map((f) => f.path) } : {},
      })
      .returning();
    if (files.length) {
      await tx.insert(artifacts).values(
        files.map((f) => ({
          projectId: created.id,
          type: "file",
          title: f.path.split("/").pop() || f.path,
          path: f.path.replace(/^[^/]+\//, "") || f.path,
          content: f.content,
          createdBy: "forge",
          version: 1,
        }))
      );
    }
    return created;
  });
  return NextResponse.json({ id: row.id, imported: files.length });
}
