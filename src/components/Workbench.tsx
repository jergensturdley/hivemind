"use client";

import { useMemo, useState } from "react";
import type { WireArtifact, WireTask } from "@/lib/events";
import { agentById, cliAgentById } from "@/lib/agents";
import { Avatar, CodeBlock, Md, cls } from "@/components/ui";

export type WorkbenchTab = "spec" | "plan" | "files" | "review";

const TABS: { id: WorkbenchTab; label: string; hint: string }[] = [
  { id: "spec", label: "Spec", hint: "product spec" },
  { id: "plan", label: "Plan", hint: "architecture & tasks" },
  { id: "files", label: "Files", hint: "mission files" },
  { id: "review", label: "Review", hint: "QA & ship" },
];

function latestByType(arts: WireArtifact[], type: string): WireArtifact[] {
  const map = new Map<string, WireArtifact>();
  for (const a of arts) {
    if (a.type !== type) continue;
    const key = a.path ?? a.title.replace(/\s+v\d+$/, "");
    const prev = map.get(key);
    if (!prev || a.version > prev.version) map.set(key, a);
  }
  return [...map.values()];
}

function allVersions(arts: WireArtifact[], type: string): WireArtifact[] {
  return arts.filter((a) => a.type === type);
}

export function Workbench({
  artifacts,
  tasks,
  tab,
  setTab,
  focusId,
}: {
  artifacts: WireArtifact[];
  tasks: WireTask[];
  tab: WorkbenchTab;
  setTab: (t: WorkbenchTab) => void;
  focusId: number | null;
}) {
  const specs = allVersions(artifacts, "spec");
  const arch = latestByType(artifacts, "arch")[0] ?? null;
  const files = useMemo(
    () => latestByType(artifacts, "file").sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "")),
    [artifacts]
  );
  const reviews = latestByType(artifacts, "review");
  const ship = latestByType(artifacts, "ship")[0] ?? null;

  const [docId, setDocId] = useState<number | null>(null);
  const [fileId, setFileId] = useState<number | null>(null);

  // Honor focus requests from chat artifact chips (adjust state on prop change).
  const [lastFocus, setLastFocus] = useState(focusId);
  if (focusId !== lastFocus) {
    setLastFocus(focusId);
    const a = focusId == null ? undefined : artifacts.find((x) => x.id === focusId);
    if (a) {
      if (a.type === "file") setFileId(a.id);
      else setDocId(a.id);
    }
  }

  // Selected doc: the picked spec if valid, else whatever the focus set, else the latest spec.
  const doc = specs.find((s) => s.id === docId) ?? artifacts.find((a) => a.id === docId) ?? specs[specs.length - 1] ?? null;
  const file = artifacts.find((a) => a.id === fileId) ?? files[0] ?? null;

  const counts: Record<WorkbenchTab, number> = {
    spec: specs.length,
    plan: arch ? 1 : 0,
    files: files.length,
    review: reviews.length + (ship ? 1 : 0),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-bg1 px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.hint}
            className={`relative min-h-11 rounded-t-md px-3 py-1.5 text-[12px] font-bold tracking-wide transition cursor-pointer lg:min-h-0 ${cls.focus} ${
              tab === t.id ? "bg-bg0 text-honey" : "text-mut hover:text-ink"
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${tab === t.id ? "bg-honey/15 text-honey" : "bg-bg3 text-dim"}`}>
                {counts[t.id]}
              </span>
            )}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-px bg-honey" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg0 p-4">
        {tab === "spec" && <DocPane doc={doc} versions={specs} onPick={setDocId} empty="The swarm drafts the product spec during the Spec stage." />}

        {tab === "plan" && (
          <div className="space-y-4">
            {arch ? (
              <div className={`${cls.card} p-4`}>
                <Md text={arch.content} />
              </div>
            ) : (
              <Empty note="Vector publishes the architecture during the Plan stage." />
            )}
            <TaskBoard tasks={tasks} />
          </div>
        )}

        {tab === "files" &&
          (files.length === 0 ? (
            <Empty note="Forge writes implementation files during the Build stage." />
          ) : (
            <div className="grid min-h-0 grid-cols-[190px_1fr] gap-3">
              <div className="space-y-1 self-start">
                {files.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFileId(f.id)}
                    className={`block min-h-11 w-full truncate rounded-md border px-2.5 py-1.5 text-left font-mono text-[11.5px] transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                      file?.id === f.id
                        ? "border-honey/50 bg-honey/10 text-honey2"
                        : "border-line bg-bg1 text-mut hover:border-line2 hover:text-ink"
                    }`}
                  >
                    {f.path ?? f.title}
                    {f.version > 1 && <span className="ml-1 text-[9px] text-ok">v{f.version}</span>}
                    {f.meta?.simulated === true && (
                      <span className="ml-1 text-[9px] text-dim" title="Generated from a mission template, not a live model">
                        sim
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="min-w-0">
                {file && <CodeBlock title={`${file.path ?? file.title} · v${file.version}`} lang={langFor(file.path ?? file.title)} code={file.content} />}
              </div>
            </div>
          ))}

        {tab === "review" && (
          <div className="space-y-4">
            {reviews.length === 0 && !ship && <Empty note="Sentinel reviews the code and Probe verifies it before shipping." />}
            {reviews.map((r) => (
              <div key={r.id} className={`${cls.card} p-4`}>
                <Md text={r.content} />
              </div>
            ))}
            {ship && (
              <div className="rounded-lg border border-ok/30 bg-ok/[0.05] p-4">
                <Md text={ship.content} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function langFor(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "ts";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".css")) return "css";
  return "code";
}

function Empty({ note }: { note: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line2 py-16 text-center">
      <div>
        <div className="font-display text-[15px] font-bold text-dim">Nothing here yet</div>
        <div className="mt-1 max-w-[300px] text-[12px] text-dim">{note}</div>
      </div>
    </div>
  );
}

function DocPane({
  doc,
  versions,
  onPick,
  empty,
}: {
  doc: WireArtifact | null;
  versions: WireArtifact[];
  onPick: (id: number) => void;
  empty: string;
}) {
  if (!doc) return <Empty note={empty} />;
  return (
    <div>
      {versions.length > 1 && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-dim">VERSIONS</span>
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => onPick(v.id)}
              className={`min-h-11 rounded-full px-2 py-0.5 text-[11px] font-bold transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                v.id === doc.id ? "bg-honey text-on-honey" : "bg-bg2 text-mut hover:text-ink"
              }`}
            >
              v{v.version}
            </button>
          ))}
        </div>
      )}
      <div className={`${cls.card} p-4`}>
        <Md text={doc.content} />
      </div>
    </div>
  );
}

function TaskBoard({ tasks }: { tasks: WireTask[] }) {
  if (!tasks.length) return null;
  const cols: { id: string; label: string; hue: number }[] = [
    { id: "backlog", label: "Queued", hue: 215 },
    { id: "building", label: "In progress", hue: 38 },
    { id: "done", label: "Done", hue: 145 },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cols.map((c) => {
        const items = tasks.filter((t) => (c.id === "done" ? t.status === "done" : c.id === "building" ? t.status === "building" : t.status === "backlog"));
        return (
          <div key={c.id} className="rounded-lg border border-line bg-bg1/60 p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold tracking-wider text-mut uppercase">{c.label}</span>
              <span className="rounded-full bg-bg3 px-1.5 text-[10px] font-bold text-dim">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((t) => {
                const a = agentById(t.assignee);
                const h = cliAgentById(t.harness || "hive");
                return (
                  <div key={t.id} className="rounded-md border border-line bg-bg2 p-2.5">
                    <div className="flex items-start gap-2">
                      {a && <Avatar hue={a.hue} glyph={a.glyph} size={18} />}
                      <div className="min-w-0">
                        <div className="text-[12px] leading-snug font-semibold text-ink">{t.title}</div>
                        <div className="mt-1 text-[11px] leading-snug text-dim">{t.detail}</div>
                        <div className="mt-1.5 font-mono text-[10px] text-mut">
                          {h.id === "hive" ? "stays in Hivemind" : `→ ${h.name} · returns here`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && <div className="rounded-md border border-dashed border-line px-2 py-3 text-center text-[11px] text-dim">empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
