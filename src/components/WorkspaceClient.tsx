"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/components/useFocusTrap";
import Link from "next/link";
import { AGENTS, cliAgentById, speakerOf } from "@/lib/agents";
import { providerById } from "@/lib/providers";
import type { WireArtifact, WireMessage } from "@/lib/events";
import { useSwarm } from "@/components/useSwarm";
import { Workbench, type WorkbenchTab } from "@/components/Workbench";
import { Terminal } from "@/components/Terminal";
import { Avatar, Md, StageTrack, cls, clock } from "@/components/ui";
import { stripThink } from "@/lib/think";

type UserLite = { id: number; name: string; hue: number };

export function WorkspaceClient({ projectId, user, autoRun }: { projectId: number; user: UserLite; autoRun: boolean }) {
  const { state, send, action, runCli } = useSwarm(projectId);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<WorkbenchTab>("spec");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [wbOpen, setWbOpen] = useState(true);
  const [wbSheet, setWbSheet] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const autoRanRef = useRef(false);

  const { project, messages, artifacts, tasks, typing, streaming, term, running, llmMode, keysConfigured, booted } = state;

  useEffect(() => {
    if (autoRun && booted && !autoRanRef.current && project && project.stage === "intake" && messages.length === 0) {
      autoRanRef.current = true;
      void action("run");
    }
  }, [autoRun, booted, project, messages.length, action]);

  useEffect(() => {
    if (stickRef.current) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages.length, typing, streaming?.text, term.length]);

  useEffect(() => {
    void (async () => {
      try {
        const [k, s] = await Promise.all([
          fetch("/api/keys").then((r) => r.json() as Promise<{ keys: { id: number; provider: string; model: string; isDefault: boolean }[] }>),
          fetch("/api/settings").then(
            (r) => r.json() as Promise<{ data?: { agents?: Record<string, { keyId?: number; model?: string }> } }>
          ),
        ]);
        const list = k.keys ?? [];
        const fallback = list.find((row) => row.isDefault) ?? list[0];
        const agents = s.data?.agents ?? {};
        const next: Record<string, string> = {};
        for (const a of AGENTS) {
          const route = agents[a.id] ?? {};
          const key = (route.keyId ? list.find((row) => row.id === route.keyId) : undefined) ?? fallback;
          if (!key) continue;
          const model = route.model?.trim() || key.model;
          if (!model) continue;
          next[a.id] = `${providerById(key.provider).label} · ${model}`;
        }
        setRoutes(next);
      } catch {
        /* roster hints are optional */
      }
    })();
  }, []);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const awaiting = project?.stage === "awaiting_approval";
  const isDone = project?.stage === "done";
  const idle = booted && !running && project && project.stage !== "done" && project.stage !== "awaiting_approval" && messages.length > 0;

  const openArtifact = (a: WireArtifact) => {
    const t: WorkbenchTab = a.type === "file" ? "files" : a.type === "arch" ? "plan" : a.type === "spec" ? "spec" : "review";
    setTab(t);
    setFocusId(a.id);
    setWbOpen(true);
    setWbSheet(true);
  };

  const toggleWorkbench = () => {
    if (wide) setWbOpen((v) => !v);
    else setWbSheet((v) => !v);
  };
  const closeSheet = useCallback(() => setWbSheet(false), []);
  useFocusTrap(wbSheet && !wide, sheetRef, closeSheet);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const submitDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void send(t);
  };

  const roster = useMemo(() => AGENTS, []);

  if (!booted || !project) {
    return (
      <div className="grid h-dvh place-items-center">
        <div className="flex items-center gap-3 text-mut">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line2 border-t-honey" />
          <span className="font-display font-bold">Attaching to mission…</span>
        </div>
      </div>
    );
  }

  const modeLabel = llmMode ? "LIVE" : keysConfigured ? "KEYS" : "SIM";
  const modeTitle = llmMode
    ? "Live model active"
    : keysConfigured
      ? "Keys ready — launch to go live"
      : "Add keys in Settings to run live models";
  const modeLong = llmMode ? "● LIVE MODEL" : keysConfigured ? "◌ KEYS READY" : "◌ SIM ENGINE";
  const primaryAction = running ? (
    <button type="button" onClick={() => action("pause")} className={`${cls.btn} shrink-0`}>
      Pause
    </button>
  ) : isDone ? (
    <Link href="/studio" className={`${cls.btnPrimary} shrink-0`}>
      <span className="sm:hidden">New</span>
      <span className="hidden sm:inline">+ New mission</span>
    </Link>
  ) : awaiting ? (
    <button type="button" onClick={() => action("approve")} className={`${cls.btnPrimary} shrink-0`}>
      <span className="sm:hidden">Approve</span>
      <span className="hidden sm:inline">✓ Approve & build</span>
    </button>
  ) : (
    <button type="button" onClick={() => action("run")} className={`${cls.btnPrimary} shrink-0`}>
      {messages.length === 0 ? "Launch" : "Resume"}
    </button>
  );

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-honey focus:px-3 focus:py-2 focus:text-[13px] focus:font-bold focus:text-on-honey"
      >
        Skip to conversation
      </a>
      {/* ---------- top bar ---------- */}
      <header className="shrink-0 border-b border-line bg-bg1 pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-12 items-center gap-2 px-3 py-1.5">
          <Link
            href="/studio"
            className="flex shrink-0 items-center gap-2 font-display text-[15px] font-bold text-honey"
            aria-label="Back to studio"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-honey/15 text-[13px]">◈</span>
            <span className="hidden sm:inline">hivemind</span>
          </Link>
          <span className="hidden text-line2 sm:inline">/</span>
          <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-ink">{project.name}</span>
          <span
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline ${
              llmMode ? "bg-ok/10 text-ok" : keysConfigured ? "bg-bg3 text-mut" : "bg-honey/10 text-honey"
            }`}
            title={modeTitle}
          >
            {modeLong}
          </span>
          {tasks.length > 0 && (
            <span className="hidden shrink-0 rounded-full border border-line bg-bg2 px-2 py-0.5 font-mono text-[10.5px] text-mut md:inline">
              tasks {doneCount}/{tasks.length}
            </span>
          )}
          <div className="mx-auto hidden min-w-0 overflow-x-auto xl:block">
            <StageTrack stage={project.stage} compact />
          </div>
          {primaryAction}
          <a
            href={`/api/projects/${projectId}/export`}
            download
            className={`${cls.btnGhost} shrink-0`}
            aria-label="Export mission as zip"
            title="Download the mission output as a zip"
          >
            ⤓<span className="hidden sm:inline"> Export</span>
          </a>
          <button
            type="button"
            onClick={toggleWorkbench}
            className={`${cls.btnGhost} shrink-0`}
            aria-expanded={wide ? wbOpen : wbSheet}
          >
            {wide ? (wbOpen ? "Hide files" : "Files") : wbSheet ? "Close" : "Files"}
          </button>
        </div>
      </header>

      {/* ---------- body ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* chat column */}
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {/* roster strip */}
          <div className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b border-line bg-bg1/50 px-3 sm:h-[42px] sm:px-4">
            <span className="hidden text-[10px] font-bold tracking-[0.14em] text-dim uppercase sm:inline">Swarm</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold sm:hidden ${
                llmMode ? "bg-ok/10 text-ok" : keysConfigured ? "bg-bg3 text-mut" : "bg-honey/10 text-honey"
              }`}
              title={modeTitle}
            >
              {modeLabel}
            </span>
            {roster.map((a) => (
              <div
                key={a.id}
                className="flex shrink-0 items-center gap-1.5"
                title={routes[a.id] ? `${a.name} — ${a.role} · ${routes[a.id]}` : `${a.name} — ${a.role}. ${a.blurb}`}
              >
                <Avatar hue={a.hue} glyph={a.glyph} size={22} speaking={typing === a.id} />
                <span className={`text-[11px] font-semibold ${typing === a.id ? "text-ink" : "text-dim"}`}>{a.name}</span>
                {routes[a.id] && (
                  <span className="hidden max-w-[140px] truncate font-mono text-[10px] text-dim md:inline">{routes[a.id]}</span>
                )}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    typing === a.id ? "bg-ok pulse-soft" : running ? "bg-line2" : "bg-line"
                  }`}
                />
              </div>
            ))}
            <span
              className="ml-auto hidden shrink-0 items-center gap-1.5 text-[11px] text-dim lg:flex"
              title="Hivemind is home base. Atlas dispatches workers; every patch returns here."
            >
              hub: <b className="font-mono text-mut">Hivemind</b>
              <span className="text-dim">·</span>
              prefer: <b className="font-mono text-mut">{cliAgentById(project.cliAgent).name}</b>
            </span>
          </div>

          {/* feed */}
          <div
            ref={feedRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            {/* mission brief */}
            <div className={`${cls.card} mb-5 border-honey/20 bg-gradient-to-br from-bg1 to-bg2 p-4`}>
              <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-honey uppercase">
                <span>◈ Mission brief</span>
                <span className="hidden text-dim normal-case tracking-normal sm:inline">— the single spec that drives everything</span>
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-mut">{project.spec}</p>
            </div>

            {messages.length === 0 && !running && (
              <div className="grid place-items-center py-14">
                <div className="text-center">
                  <div className="font-display text-[19px] font-bold text-ink">The swarm is assembled.</div>
                  <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] text-mut">
                    Six specialists are standing by. Launch and Atlas will run intake → spec → plan → critique, then hand the
                    build back to you for approval.
                  </p>
                  <button onClick={() => action("run")} className={`${cls.btnPrimary} mt-5 !px-6 !py-2.5 !text-[14px]`}>
                    ▶ Launch the swarm
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((m) => (
                <MessageRow key={m.id} m={m} user={user} artifacts={artifacts} onOpenArtifact={openArtifact} />
              ))}

              {streaming && (
                <AgentBubble agentId={streaming.agent} time={new Date().toISOString()} route={routes[streaming.agent]}>
                  <Md text={streaming.text} />
                  <span className="caret-blink ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-honey" />
                </AgentBubble>
              )}

              {!streaming && typing && (
                <div className="flex items-center gap-2.5 pl-1">
                  <AvatarOf author={typing} size={26} />
                  <div className="flex items-center gap-1 rounded-full border border-line bg-bg1 px-3 py-2">
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mut" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mut" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-mut" />
                  </div>
                  <span className="text-[11px] text-dim">{speakerOf(typing).name} is writing…</span>
                </div>
              )}
            </div>

            {awaiting && !running && (
              <div className="fade-up mt-5 rounded-lg border border-honey/40 bg-honey/[0.06] p-4">
                <div className="font-display text-[14px] font-bold text-honey2">Your call, Commander.</div>
                <p className="mt-1 text-[12.5px] text-mut">
                  The plan survived critique. Approve to start the build, or type revision notes and the swarm will rework the
                  spec.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button type="button" onClick={() => action("approve")} className={cls.btnPrimary}>
                    ✓ Approve & start build
                  </button>
                  <button type="button" onClick={() => setDraft("Before we build: ")} className={cls.btn}>
                    ✎ Request changes…
                  </button>
                </div>
              </div>
            )}

            {idle && (
              <div className="mt-5 flex items-center gap-3 rounded-lg border border-line bg-bg1 p-3">
                <span className="text-[12.5px] text-mut">Swarm paused mid-mission.</span>
                <button onClick={() => action("run")} className={cls.btn}>
                  ▶ Resume
                </button>
              </div>
            )}
          </div>

          {/* composer */}
          <div className="shrink-0 border-t border-line bg-bg1 p-3">
            <div className="flex items-end gap-2 rounded-lg border border-line2 bg-bg0 p-2 focus-within:border-honey/50">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                rows={draft.split("\n").length > 3 ? 4 : Math.max(1, draft.split("\n").length)}
                placeholder={
                  awaiting
                    ? "Approve, or tell the swarm what to change…"
                    : running
                      ? "Interrupt the swarm…"
                      : isDone
                        ? "Mission shipped — start a new one from Studio…"
                        : "Steer the swarm…"
                }
                aria-label="Message the swarm"
                className="max-h-[120px] min-h-11 flex-1 resize-none bg-transparent px-1.5 py-2 text-base text-ink placeholder:text-dim outline-none lg:text-[13px]"
              />
              <button type="button" onClick={submitDraft} disabled={!draft.trim()} className={`${cls.btnPrimary} shrink-0`}>
                Send
              </button>
            </div>
            <div className="mt-1.5 hidden items-center justify-between px-1 text-[10.5px] text-dim sm:flex">
              <span>Enter to send · Shift+Enter for newline · messages interrupt the live run</span>
              <span className="font-mono">{running ? "swarm active" : "swarm idle"}</span>
            </div>
          </div>
        </main>

        {/* workbench — side pane on desktop, sheet on small screens */}
        {wbOpen && (
          <aside className="hidden w-[440px] shrink-0 border-l border-line lg:block xl:w-[500px]">
            <Workbench artifacts={artifacts} tasks={tasks} tab={tab} setTab={setTab} focusId={focusId} />
          </aside>
        )}
        {wbSheet && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label="Close workbench"
              onClick={() => setWbSheet(false)}
            />
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label="Workbench"
              className="absolute inset-0 flex flex-col bg-bg0 pt-[env(safe-area-inset-top)]"
            >
              <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-line px-3">
                <span className="font-display text-[15px] font-bold text-ink">Workbench</span>
                <button type="button" onClick={() => setWbSheet(false)} className={cls.btn}>
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
                <Workbench artifacts={artifacts} tasks={tasks} tab={tab} setTab={setTab} focusId={focusId} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* terminal */}
      <Terminal lines={term} onCommand={runCli} open={termOpen} setOpen={setTermOpen} cliAgentId={project.cliAgent} />
    </div>
  );
}

/* ---------------- message rendering ---------------- */

function AvatarOf({ author, size = 30 }: { author: string; size?: number }) {
  if (author === "user") {
    return <Avatar hue={38} glyph="»" size={size} className="!bg-bg3 !text-honey2" />;
  }
  const a = speakerOf(author);
  return <Avatar hue={a.hue} glyph={a.glyph} size={size} />;
}

function routeLabel(meta: Record<string, unknown> | undefined): string | undefined {
  const provider = typeof meta?.provider === "string" ? meta.provider : "";
  const model = typeof meta?.model === "string" ? meta.model : "";
  if (!provider && !model) return undefined;
  const name = provider ? providerById(provider).label : "";
  return [name, model].filter(Boolean).join(" · ");
}

function AgentBubble({
  agentId,
  time,
  route,
  sim,
  children,
}: {
  agentId: string;
  time: string;
  route?: string;
  sim?: boolean;
  children: React.ReactNode;
}) {
  const a = speakerOf(agentId);
  return (
    <div className="fade-up flex gap-2.5">
      <AvatarOf author={agentId} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-[12.5px] font-bold text-ink">{a.name}</span>
          <span className="text-[10.5px] font-semibold" style={{ color: `hsl(${a.hue} 70% 65%)` }}>
            {a.role}
          </span>
          {sim && (
            <span
              title="Simulated stand-in — not live model output"
              className="rounded-full border border-line2 bg-bg2 px-1.5 text-[9px] font-bold tracking-wide text-dim uppercase"
            >
              sim
            </span>
          )}
          {route && <span className="font-mono text-[10px] text-dim">{route}</span>}
          <span className="text-[10px] text-dim">{clock(time)}</span>
        </div>
        <div className={`${cls.card} rounded-tl-sm p-3`}>{children}</div>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  user,
  artifacts,
  onOpenArtifact,
}: {
  m: WireMessage;
  user: UserLite;
  artifacts: WireArtifact[];
  onOpenArtifact: (a: WireArtifact) => void;
}) {
  const artifact = m.meta?.artifactId ? artifacts.find((a) => a.id === Number(m.meta.artifactId)) : undefined;
  const body = stripThink(m.content);
  if (!body && !artifact) return null;

  if (m.author === "system" || m.kind === "status") {
    return (
      <div className="fade-up flex justify-center">
        <span className="rounded-full border border-line bg-bg1 px-3 py-1 text-[11px] text-dim">{m.content}</span>
      </div>
    );
  }

  if (m.kind === "stage" || m.author === "atlas") {
    return (
      <AgentBubble agentId="atlas" time={m.createdAt} route={routeLabel(m.meta)} sim={m.meta?.simulated === true}>
        {body ? <Md text={body} /> : null}
        {artifact && <ArtifactChip a={artifact} onClick={() => onOpenArtifact(artifact)} />}
      </AgentBubble>
    );
  }

  if (m.author === "user") {
    return (
      <div className="fade-up flex flex-row-reverse gap-2.5">
        <Avatar hue={user.hue} glyph={user.name[0]?.toUpperCase() ?? "U"} size={30} />
        <div className="max-w-[78%]">
          <div className="mb-1 flex items-baseline justify-end gap-2">
            <span className="text-[10px] text-dim">{clock(m.createdAt)}</span>
            <span className="text-[12.5px] font-bold text-honey2">{user.name}</span>
          </div>
          <div className="rounded-lg rounded-tr-sm border border-honey/30 bg-honey/[0.08] p-3 text-[13px] leading-relaxed text-ink">
            {m.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <AgentBubble agentId={m.author} time={m.createdAt} route={routeLabel(m.meta)} sim={m.meta?.simulated === true}>
      {body ? <Md text={body} /> : null}
      {artifact && <ArtifactChip a={artifact} onClick={() => onOpenArtifact(artifact)} />}
    </AgentBubble>
  );
}

function ArtifactChip({ a, onClick }: { a: WireArtifact; onClick: () => void }) {
  const icon = a.type === "file" ? "🗎" : a.type === "spec" ? "📋" : a.type === "arch" ? "📐" : a.type === "review" ? "🛡" : "🚀";
  return (
    <button
      onClick={onClick}
      className={`mt-2 flex w-full items-center gap-2 rounded-md border border-line2 bg-bg2 px-2.5 py-2 text-left transition hover:border-honey/50 cursor-pointer ${cls.focus}`}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-bg3 text-[13px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold text-ink">{a.title}</span>
        <span className="block text-[10.5px] text-dim">
          {a.type.toUpperCase()} · v{a.version} · open in workbench →
        </span>
      </span>
    </button>
  );
}
