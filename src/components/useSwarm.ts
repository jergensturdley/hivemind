"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SwarmEvent, TermLine, WireArtifact, WireMessage, WireTask } from "@/lib/events";

export type ProjectInfo = {
  id: number;
  name: string;
  spec: string;
  stage: string;
  running: boolean;
  cliAgent: string;
  createdAt: string;
  updatedAt: string;
};

export type SwarmState = {
  project: ProjectInfo | null;
  messages: WireMessage[];
  artifacts: WireArtifact[];
  tasks: WireTask[];
  typing: string | null;
  streaming: { agent: string; text: string } | null;
  term: TermLine[];
  running: boolean;
  llmMode: boolean;
  keysConfigured: boolean;
  booted: boolean;
};

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onData: (obj: Record<string, unknown>) => void
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          onData(JSON.parse(line.slice(5)) as Record<string, unknown>);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export function useSwarm(projectId: number) {
  const [state, setState] = useState<SwarmState>({
    project: null,
    messages: [],
    artifacts: [],
    tasks: [],
    typing: null,
    streaming: null,
    term: [{ text: "◈ swarm-cli ready — type 'help'", tone: "dim" }],
    running: false,
    llmMode: false,
    keysConfigured: false,
    booted: false,
  });
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // runningRef tracks whether an SSE loop is active in *this* tab — never
  // seed it from the DB, or auto-resume and wake-on-message become no-ops.

  const applyEvent = useCallback((ev: SwarmEvent): boolean => {
    setState((s) => {
      switch (ev.type) {
        case "turn_start":
          return { ...s, typing: ev.agent, streaming: null };
        case "delta":
          return {
            ...s,
            streaming: { agent: ev.agent, text: (s.streaming?.agent === ev.agent ? s.streaming.text : "") + ev.text },
          };
        case "message": {
          if (s.messages.some((m) => m.id === ev.msg.id)) return { ...s, typing: null, streaming: null };
          return { ...s, messages: [...s.messages, ev.msg], typing: null, streaming: null };
        }
        case "artifact": {
          const exists = s.artifacts.some((a) => a.id === ev.artifact.id);
          return {
            ...s,
            artifacts: exists
              ? s.artifacts.map((a) => (a.id === ev.artifact.id ? ev.artifact : a))
              : [...s.artifacts, ev.artifact],
          };
        }
        case "tasks":
          return { ...s, tasks: ev.tasks };
        case "stage":
          return s.project ? { ...s, project: { ...s.project, stage: ev.stage } } : s;
        case "term":
          return { ...s, term: [...s.term, ...ev.lines].slice(-400) };
        case "mode":
          return { ...s, llmMode: ev.llm };
        case "end":
          return s.project
            ? {
                ...s,
                project: { ...s.project, stage: ev.stage === "unknown" ? s.project.stage : ev.stage, running: ev.running },
                typing: null,
                streaming: null,
              }
            : s;
      }
    });
    return ev.type === "end";
  }, []);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        project: ProjectInfo;
        messages: WireMessage[];
        artifacts: WireArtifact[];
        tasks: WireTask[];
        keysConfigured: boolean;
      };
      const live = data.messages.some((m) => typeof m.meta?.provider === "string");
      setState((s) => ({
        ...s,
        project: data.project,
        messages: data.messages,
        artifacts: data.artifacts,
        tasks: data.tasks,
        keysConfigured: data.keysConfigured,
        llmMode: live,
        running: data.project.running,
        booted: true,
      }));
      return data.project.running;
    } catch {
      return false;
    }
  }, [projectId]);

  const runLoop = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState((s) => ({ ...s, running: true }));
    try {
      for (let guard = 0; guard < 40; guard++) {
        abortRef.current = new AbortController();
        const res = await fetch(`/api/projects/${projectId}/events`, { signal: abortRef.current.signal });
        if (!res.ok || !res.body) break;
        let keepsRunning = false;
        await consumeSSE(res.body, (obj) => {
          const isEnd = applyEvent(obj as unknown as SwarmEvent);
          if (isEnd) keepsRunning = !!(obj as { running?: boolean }).running;
        });
        if (!keepsRunning) break;
      }
    } catch {
      /* aborted or network */
    } finally {
      runningRef.current = false;
      setState((s) => ({ ...s, running: false, typing: null, streaming: null }));
      hydrate();
    }
  }, [projectId, applyEvent, hydrate]);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          { id: -Date.now(), author: "user", kind: "chat", content, meta: {}, createdAt: new Date().toISOString() },
        ],
      }));
      try {
        const res = await fetch(`/api/projects/${projectId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const data = (await res.json()) as { wake?: boolean };
        if (data.wake && !runningRef.current) void runLoop();
      } catch {
        /* ignore */
      }
    },
    [projectId, runLoop]
  );

  const action = useCallback(
    async (type: "approve" | "pause" | "run") => {
      await fetch(`/api/projects/${projectId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (type !== "pause" && !runningRef.current) void runLoop();
      else if (type === "pause") {
        abortRef.current?.abort();
        setState((s) => ({ ...s, running: false }));
      }
    },
    [projectId, runLoop]
  );

  const runCli = useCallback(
    async (command: string): Promise<void> => {
      const cmd = command.trim();
      if (!cmd) return;
      setState((s) => ({ ...s, term: [...s.term, { text: `$ ${cmd}`, tone: "cmd" as const }].slice(-400) }));
      const lower = cmd.toLowerCase();
      if (lower === "clear") {
        setState((s) => ({ ...s, term: [{ text: "◈ cleared", tone: "dim" as const }] }));
        return;
      }
      if (lower === "run" || lower === "build" || lower === "resume") {
        setState((s) => ({ ...s, term: [...s.term, { text: "◈ delegating to orchestrator — watch the chat", tone: "ok" as const }] }));
        void action("run");
        return;
      }
      if (lower === "pause") {
        void action("pause");
        setState((s) => ({ ...s, term: [...s.term, { text: "◈ swarm paused", tone: "warn" as const }] }));
        return;
      }
      if (lower === "approve") {
        void action("approve");
        setState((s) => ({ ...s, term: [...s.term, { text: "◈ plan approved — build starting", tone: "ok" as const }] }));
        return;
      }
      try {
        const res = await fetch(`/api/projects/${projectId}/cli`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: cmd }),
        });
        if (!res.ok) return;
        const obj = (await res.json()) as { lines?: TermLine[]; cliAgent?: string; wake?: boolean };
        const lines = obj.lines;
        const nextAgent = obj.cliAgent;
        if (lines || nextAgent) {
          setState((s) => ({
            ...s,
            term: lines ? [...s.term, ...lines].slice(-400) : s.term,
            project: s.project && nextAgent && nextAgent !== s.project.cliAgent
              ? { ...s.project, cliAgent: nextAgent }
              : s.project,
          }));
        }
        if (obj.wake && !runningRef.current) void runLoop();
      } catch {
        /* ignore */
      }
    },
    [projectId, action, runLoop]
  );

  useEffect(() => {
    void (async () => {
      const wasRunning = await hydrate();
      if (wasRunning) void runLoop();
    })();
    return () => abortRef.current?.abort();
  }, [hydrate, runLoop]);

  return { state, send, action, runCli, runLoop, hydrate };
}
