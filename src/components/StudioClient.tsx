"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/components/useFocusTrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STAGES, stageIndex } from "@/lib/agents";
import { isHarnessId, type HarnessId } from "@/lib/harnesses";
import {
  folderNameFromPaths,
  inferSpecFromFiles,
  sanitizeImportFiles,
  shouldSkipImportPath,
  IMPORT_LIMITS,
  type ImportFile,
} from "@/lib/import-folder";
import { cls, timeAgo } from "@/components/ui";
import { Shell } from "@/components/Shell";
import { HarnessGrid } from "@/components/HarnessGrid";

type Mission = {
  id: number;
  name: string;
  spec: string;
  stage: string;
  running: boolean;
  cliAgent: string;
  updatedAt: string;
  fixture?: boolean;
  counts: { messages: number; tasks: number; files: number };
};

const TEMPLATES = [
  {
    id: "blank",
    label: "Blank",
    spec: "",
  },
  {
    id: "saas",
    label: "SaaS analytics",
    spec: `Signalcraft — a product analytics app for indie hackers.

It should:
- Ingest events via a tiny JS snippet and an HTTP endpoint
- Show funnels, retention cohorts and a live activity stream
- Let founders annotate launches on the timeline
- Email a weekly growth digest
- Be fast enough to feel instant`,
  },
  {
    id: "internal",
    label: "Internal tool",
    spec: `Dispatch Deck — an ops console for a delivery fleet.

It should:
- Show every vehicle on a live status board with ETA countdowns
- Let dispatchers reassign stops with drag-free keyboard shortcuts
- Flag exceptions (late, idle, off-route) with one-click escalation
- Keep an auditable log of every dispatch decision`,
  },
  {
    id: "marketplace",
    label: "Marketplace",
    spec: `Toolshed — a neighborhood tool-lending marketplace.

It should:
- Let neighbors list tools with photos, deposit and availability
- Support request → approve → pickup → return flows
- Handle deposits with a simple hold/release ledger
- Build trust with mutual ratings and a blocklist`,
  },
];

export function StudioClient({ user }: { user: { id: number; name: string; email: string; hue: number } }) {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [keysConfigured, setKeysConfigured] = useState(false);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [cliAgent, setCliAgent] = useState<HarnessId>("hive");
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const importDialogRef = useRef<HTMLDivElement>(null);
  const importNameRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<ImportFile[]>([]);
  const [importSkipped, setImportSkipped] = useState(0);
  const [importName, setImportName] = useState("");
  const [importSpec, setImportSpec] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const closeModal = useCallback(() => setModal(false), []);
  const closeImport = useCallback(() => {
    setImportOpen(false);
    setImportError(null);
  }, []);
  useFocusTrap(modal, dialogRef, closeModal, nameRef);
  useFocusTrap(importOpen, importDialogRef, closeImport, importNameRef);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        setLoadError("Could not load missions. Retry in a moment.");
        setMissions([]);
        return;
      }
      const data = (await res.json()) as { projects: Mission[]; keysConfigured: boolean };
      setMissions(data.projects);
      setKeysConfigured(data.keysConfigured);
      setLoadError(null);
    } catch {
      setLoadError("Network error — missions did not load.");
      setMissions([]);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount; every setState inside `load` settles after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => (r.ok ? (r.json() as Promise<{ data: { cliAgent?: string } }>) : null))
      .then((data) => {
        const id = data?.data?.cliAgent;
        if (id && isHarnessId(id)) setCliAgent(id);
      })
      .catch(() => {
        /* keep hive */
      });
  }, []);

  const create = async () => {
    if (spec.trim().length < 20) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, spec, cliAgent }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        setCreateError(data.error ?? "Could not create the mission. Try again.");
        return;
      }
      router.push(`/studio/${data.id}?run=1`);
    } catch {
      setCreateError("Network error — the mission was not created.");
    } finally {
      setCreating(false);
    }
  };

  const pickFolder = () => folderRef.current?.click();

  const onFolderPicked = async (list: FileList | null) => {
    if (!list?.length) return;
    const raw: ImportFile[] = [];
    for (const file of Array.from(list)) {
      const rel = file.webkitRelativePath || file.name;
      if (shouldSkipImportPath(rel) || file.size > IMPORT_LIMITS.maxBytesEach) continue;
      try {
        raw.push({ path: rel, content: await file.text() });
      } catch {
        /* unreadable */
      }
    }
    const { files, skipped } = sanitizeImportFiles(raw);
    if (!files.length) {
      setImportError("No readable source files in that folder (binaries, node_modules, and locks are skipped).");
      setImportOpen(true);
      setImportFiles([]);
      return;
    }
    const folder = folderNameFromPaths(files.map((f) => f.path));
    setImportFiles(files);
    setImportSkipped(skipped + (raw.length - files.length));
    setImportName(folder.slice(0, 60));
    setImportSpec(inferSpecFromFiles(files, folder));
    setImportError(null);
    setImportOpen(true);
    if (folderRef.current) folderRef.current.value = "";
  };

  const importMission = async () => {
    if (importFiles.length === 0 || importSpec.trim().length < 20) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: importName, spec: importSpec, cliAgent, files: importFiles }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        setImportError(data.error ?? "Could not import the folder. Try again.");
        return;
      }
      router.push(`/studio/${data.id}?run=1`);
    } catch {
      setImportError("Network error — the folder was not imported.");
    } finally {
      setImporting(false);
    }
  };

  const remove = async (id: number) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setConfirmId(null);
      void load();
    } catch {
      /* keep the card; user can retry */
    }
  };

  return (
    <Shell user={user}>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-bold text-ink">Mission Studio</h1>
            <p className="mt-1 text-[13.5px] text-mut">
              Start from a spec, or import a folder you already have. The swarm takes it from there.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={pickFolder} className={cls.btn}>
              Import folder
            </button>
            <button type="button" onClick={() => setModal(true)} className={`${cls.btnPrimary} !px-5 !py-2.5`}>
              + New mission
            </button>
          </div>
        </div>

        {!keysConfigured && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-honey/30 bg-honey/[0.05] px-4 py-3">
            <span className="text-honey">◌</span>
            <span className="text-[13px] text-mut">
              Running on the <b className="text-ink">simulation engine</b> — missions complete end-to-end with scripted
              specialists. Wire up your own OpenAI / Anthropic key for live models.
            </span>
            <button onClick={() => router.push("/settings")} className={`${cls.btn} ml-auto`}>
              Add keys →
            </button>
          </div>
        )}

        {missions === null ? (
          <div className="grid h-40 place-items-center text-mut" role="status" aria-label="Loading missions">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line2 border-t-honey" />
          </div>
        ) : loadError ? (
          <div className={`${cls.card} flex flex-wrap items-center gap-3 p-4`}>
            <p className="text-[13px] text-err">{loadError}</p>
            <button type="button" onClick={() => void load()} className={cls.btn}>
              Retry
            </button>
          </div>
        ) : missions.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-line2 py-20">
            <div className="text-center">
              <div className="font-display text-[18px] font-bold text-ink">No missions yet</div>
              <p className="mt-1 text-[13px] text-mut">Write a spec, or import an existing project folder.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={pickFolder} className={cls.btn}>
                  Import folder
                </button>
                <button type="button" onClick={() => setModal(true)} className={cls.btnPrimary}>
                  + New mission
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {missions.map((m) => {
              const stageDef = STAGES.find((s) => s.id === m.stage);
              const idx = stageIndex(m.stage);
              const done = m.stage === "done";
              return (
                <article key={m.id} className={`${cls.card} flex flex-col p-4 transition hover:border-line2`}>
                  <Link
                    href={`/studio/${m.id}`}
                    className="flex flex-1 flex-col rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey/80 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-display text-[16px] font-bold text-ink">{m.name}</div>
                        <div className="mt-0.5 text-[11px] text-dim">updated {timeAgo(m.updatedAt)}</div>
                      </div>
                    <div className="flex items-center gap-1.5">
                      {m.fixture && (
                        <span
                          className="shrink-0 rounded-full border border-line2 bg-bg2 px-2 py-0.5 text-[9px] font-bold tracking-wide text-dim uppercase"
                          title="Demonstration mission seeded by Hivemind — not your work"
                        >
                          demo
                        </span>
                      )}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          done ? "bg-ok/10 text-ok" : m.running ? "bg-honey/10 text-honey" : "bg-bg3 text-mut"
                        }`}
                      >
                        {m.running ? "● ACTIVE" : stageDef?.short ?? m.stage}
                      </span>
                    </div>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-[36px] text-[12px] leading-relaxed text-mut">{m.spec}</p>
                    <div
                      className="mt-3 h-1 overflow-hidden rounded-full bg-bg3"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(((done ? STAGES.length : idx) / STAGES.length) * 100)}
                      aria-label={`${m.name} stage progress`}
                    >
                      <div
                        className={`h-full rounded-full transition-all ${done ? "bg-ok" : "bg-honey"}`}
                        style={{ width: `${Math.round(((done ? STAGES.length : idx) / STAGES.length) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-3 font-mono text-[11px] text-dim">
                      💬 {m.counts.messages} · ☑ {m.counts.tasks} · 🗎 {m.counts.files}
                    </div>
                  </Link>
                  <div className="mt-1 flex items-center justify-between">
                    <a
                      href={`/api/projects/${m.id}/export`}
                      download
                      className="inline-flex min-h-11 items-center gap-1 rounded px-1.5 text-[11px] text-mut transition hover:text-honey2 cursor-pointer"
                      aria-label={`Export ${m.name} as zip`}
                    >
                      ⤓ Export
                    </a>
                    {confirmId === m.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void remove(m.id)}
                          className={`${cls.btn} !border-err/50 !text-err !px-2 !text-[11px]`}
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className={`${cls.btnGhost} !px-2 !text-[11px]`}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(m.id)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-mut transition hover:text-err cursor-pointer"
                        aria-label={`Delete ${m.name}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* new mission modal */}
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setModal(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-mission-title"
            className={`${cls.card} fade-up max-h-[90vh] w-full max-w-[640px] overflow-y-auto border-line2 bg-bg1 p-5`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id="new-mission-title" className="font-display text-[18px] font-bold text-ink">
                New mission
              </h2>
              <button
                ref={modalCloseRef}
                type="button"
                onClick={() => setModal(false)}
                className={`${cls.btnGhost} !min-h-11 !min-w-11`}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-mut">
              Write the spec once. The swarm derives everything — product spec, architecture, tasks, code, review.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSpec(t.spec);
                    if (t.spec && !name) setName(t.spec.split(/\s+/)[0].replace(/[—:-]/g, ""));
                  }}
                  className={`${cls.chip} min-h-11 cursor-pointer transition hover:border-honey/50 hover:text-ink lg:min-h-0 ${cls.focus}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="mission-name" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                  Mission name
                </label>
                <input
                  ref={nameRef}
                  id="mission-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lumen Board"
                  className={cls.input}
                />
              </div>
              <div>
                <label htmlFor="mission-spec" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                  Spec
                </label>
                <textarea
                  id="mission-spec"
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  rows={9}
                  placeholder={"Describe the app in one shot — what it does, for whom, and the features you expect.\n\nBullet lists work great."}
                  className={`${cls.input} resize-none leading-relaxed`}
                />
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold tracking-wide text-mut uppercase">Preferred worker (Atlas still routes per task)</div>
                <p className="mb-2 text-[11.5px] text-dim">
                  Atlas fans implementation out from this preference. Construction, critique, review, and QA always return to Hivemind.
                </p>
                <HarnessGrid value={cliAgent} onChange={setCliAgent} />
              </div>
            </div>

            {createError && (
              <p className="mt-3 text-[12.5px] text-err" role="alert">
                {createError}
              </p>
            )}
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-dim">{spec.trim().length >= 20 ? "Spec looks good ✓" : "Give the swarm at least a sentence"}</span>
              <button type="button" onClick={() => void create()} disabled={creating || spec.trim().length < 20} className={cls.btnPrimary}>
                {creating ? "Spinning up…" : "▶ Create & launch"}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={folderRef}
        type="file"
        className="sr-only"
        multiple
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void onFolderPicked(e.target.files)}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />

      {importOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={closeImport}>
          <div
            ref={importDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-mission-title"
            className={`${cls.card} fade-up max-h-[90vh] w-full max-w-[640px] overflow-y-auto border-line2 bg-bg1 p-5`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id="import-mission-title" className="font-display text-[18px] font-bold text-ink">
                Import mission
              </h2>
              <button type="button" onClick={closeImport} className={`${cls.btnGhost} !min-h-11 !min-w-11`} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-mut">
              Files come from this browser’s folder picker — the server never reads a path on the machine. Init runs the swarm against that tree.
            </p>

            {importFiles.length > 0 && (
              <p className="mt-3 font-mono text-[11.5px] text-dim">
                {importFiles.length} files ready{importSkipped > 0 ? ` · ${importSkipped} skipped` : ""}
              </p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="import-name" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                  Mission name
                </label>
                <input
                  ref={importNameRef}
                  id="import-name"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  className={cls.input}
                />
              </div>
              <div>
                <label htmlFor="import-spec" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                  Spec (from the folder, editable)
                </label>
                <textarea
                  id="import-spec"
                  value={importSpec}
                  onChange={(e) => setImportSpec(e.target.value)}
                  rows={8}
                  className={`${cls.input} resize-none font-mono leading-relaxed lg:text-[12px]`}
                />
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold tracking-wide text-mut uppercase">Preferred worker</div>
                <HarnessGrid value={cliAgent} onChange={setCliAgent} />
              </div>
            </div>

            {importError && (
              <p className="mt-3 text-[12.5px] text-err" role="alert">
                {importError}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={pickFolder} className={cls.btn} disabled={importing}>
                Choose different folder
              </button>
              <button
                type="button"
                onClick={() => void importMission()}
                disabled={importing || importFiles.length === 0 || importSpec.trim().length < 20}
                className={cls.btnPrimary}
              >
                {importing ? "Importing…" : "Init mission"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
