"use client";

import { useEffect, useRef, useState } from "react";
import type { TermLine } from "@/lib/events";
import { cliAgentById } from "@/lib/agents";
import { cls } from "@/components/ui";

const toneCls: Record<string, string> = {
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  dim: "text-dim",
  cmd: "text-honey2",
};

export function Terminal({
  lines,
  onCommand,
  open,
  setOpen,
  cliAgentId,
}: {
  lines: TermLine[];
  onCommand: (cmd: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  cliAgentId: string;
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agent = cliAgentById(cliAgentId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, open]);

  const submit = () => {
    const cmd = value.trim();
    if (!cmd) return;
    onCommand(cmd);
    setHistory((h) => [cmd, ...h].slice(0, 50));
    setHistIdx(-1);
    setValue("");
  };

  return (
    <div
      className={`flex shrink-0 flex-col border-t border-line bg-term pb-[env(safe-area-inset-bottom)] transition-[height] ${
        open ? "h-[min(32vh,200px)] lg:h-[230px]" : "h-11"
      }`}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md text-[12px] font-bold text-mut hover:text-ink cursor-pointer ${cls.focus}`}
          aria-expanded={open}
        >
          <span className="text-honey">{open ? "▾" : "▸"}</span>
          <span>swarm-cli</span>
          <span className="hidden truncate font-mono text-[10px] text-dim sm:inline">bridge → {agent.name}</span>
        </button>
        <div className="hidden items-center gap-2 text-[10px] font-semibold text-dim md:flex">
          <span className="rounded border border-line px-1.5 py-0.5 font-mono">help</span>
          <span className="rounded border border-line px-1.5 py-0.5 font-mono">status</span>
          <span className="rounded border border-line px-1.5 py-0.5 font-mono">harness</span>
          <span className="rounded border border-line px-1.5 py-0.5 font-mono">{`cli ${agent.id} "task"`}</span>
        </div>
      </div>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-1 font-mono text-[11.5px] leading-[1.7]">
            {lines.map((l, i) => (
              <div key={i} className={`whitespace-pre-wrap ${toneCls[l.tone ?? ""] ?? "text-code"}`}>
                {l.text}
              </div>
            ))}
          </div>
          <div className="flex min-h-11 items-center gap-2 border-t border-line/60 px-3 py-1.5">
            <span className="hidden font-mono text-[11.5px] text-ok sm:inline">you@hive</span>
            <span className="font-mono text-[11.5px] text-dim">~$</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="swarm-cli command"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const ni = Math.min(histIdx + 1, history.length - 1);
                  if (history[ni]) {
                    setHistIdx(ni);
                    setValue(history[ni]);
                  }
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const ni = histIdx - 1;
                  setHistIdx(ni);
                  setValue(ni >= 0 ? history[ni] : "");
                }
              }}
              placeholder="try: harness · harness use grok · cli grok 'add tests'"
              className="min-h-11 flex-1 bg-transparent font-mono text-base text-ink placeholder:text-dim/70 outline-none lg:min-h-0 lg:text-[11.5px]"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
