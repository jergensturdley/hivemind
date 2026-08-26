import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, artifacts } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { safeOutPath } from "@/lib/engine";
import { buildZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export the mission as a zip: file artifacts at their paths, docs alongside, honest notices. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.userId, user.id))).limit(1);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows = await db.select().from(artifacts).where(eq(artifacts.projectId, pid)).orderBy(asc(artifacts.id));

  // Latest file artifact per path (rows ascend, so equal versions keep the newest row).
  const files = new Map<string, { content: string; simulated: boolean }>();
  for (const a of rows) {
    if (a.type !== "file" || !a.path) continue;
    const path = safeOutPath(a.path);
    if (!path) continue;
    files.set(path, { content: a.content, simulated: a.meta?.simulated === true });
  }

  const latestDoc = (type: string, qa: boolean) => {
    let best: typeof rows[number] | null = null;
    for (const a of rows) {
      if (a.type !== type) continue;
      if ((a.title.startsWith("QA checklist")) !== qa) continue;
      if (!best || a.version >= best.version) best = a;
    }
    return best;
  };

  const entries: ZipEntry[] = [...files].map(([path, f]) => ({ path, content: f.content }));
  const pushDoc = (name: string, a: typeof rows[number] | null) => {
    if (a) entries.push({ path: `docs/${name}`, content: a.content });
  };
  pushDoc("spec.md", latestDoc("spec", false));
  pushDoc("architecture.md", latestDoc("arch", false));
  pushDoc("review.md", latestDoc("review", false));
  pushDoc("qa-checklist.md", latestDoc("review", true));
  pushDoc("ship-report.md", latestDoc("ship", false));

  const simulated = [...files].filter(([, f]) => f.simulated);
  if (simulated.length) {
    entries.push({
      path: "SIMULATED.md",
      content:
        `# Simulated content notice\n\n` +
        `Parts of this export came from the Hivemind simulation engine, not a live model:\n\n` +
        `${simulated.map(([path]) => `- \`${path}\``).join("\n")}\n\n` +
        `Run the mission with a provider key configured to generate real output.\n`,
    });
  }
  if (!entries.length) {
    return NextResponse.json({ error: "nothing to export yet" }, { status: 409 });
  }

  const zip = buildZip(entries);
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mission";
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug}-${pid}.zip"`,
      "cache-control": "no-store",
    },
  });
}
