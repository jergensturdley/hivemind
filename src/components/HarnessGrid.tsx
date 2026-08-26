"use client";

import { useEffect, useState } from "react";
import { HARNESSES, type HarnessId } from "@/lib/harnesses";
import { Avatar, cls } from "@/components/ui";

export type HarnessStatusLite = {
  id: string;
  installed: boolean;
  binPath: string | null;
};

function useHarnessStatus(): HarnessStatusLite[] | null {
  const [rows, setRows] = useState<HarnessStatusLite[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/harnesses")
      .then((r) => (r.ok ? (r.json() as Promise<{ harnesses: HarnessStatusLite[] }>) : null))
      .then((data) => {
        if (alive && data?.harnesses) setRows(data.harnesses);
      })
      .catch(() => {
        /* ignore — picker still works without PATH probes */
      });
    return () => {
      alive = false;
    };
  }, []);
  return rows;
}

function badge(id: string, statuses: HarnessStatusLite[] | null): { label: string; cls: string } {
  if (id === "hive") return { label: "native", cls: "text-ok" };
  const row = statuses?.find((s) => s.id === id);
  if (!statuses) return { label: "bridge", cls: "text-dim" };
  if (row?.installed) return { label: "on PATH", cls: "text-ok" };
  return { label: "off PATH", cls: "text-dim" };
}

export function HarnessGrid({
  value,
  onChange,
  layout = "grid",
}: {
  value: string;
  onChange: (id: HarnessId) => void;
  layout?: "grid" | "list";
}) {
  const statuses = useHarnessStatus();

  if (layout === "list") {
    return (
      <div className="space-y-2">
        {HARNESSES.map((c) => {
          const active = value === c.id;
          const b = badge(c.id, statuses);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(c.id)}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition cursor-pointer ${cls.focus} ${
                active ? "border-honey/60 bg-honey/[0.07]" : "border-line bg-bg2 hover:border-line2"
              }`}
            >
              <Avatar hue={c.hue} glyph={c.glyph} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-ink">{c.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${b.cls}`}>{b.label}</span>
                </span>
                <span className="block text-[11px] text-dim">{c.desc}</span>
                <span className="mt-1 block truncate font-mono text-[10.5px] text-dim">$ {c.template}</span>
              </span>
              <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${active ? "border-honey bg-honey" : "border-line2"}`} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {HARNESSES.map((c) => {
        const active = value === c.id;
        const b = badge(c.id, statuses);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.id)}
            className={`rounded-lg border p-2.5 text-left transition cursor-pointer ${cls.focus} ${
              active ? "border-honey/60 bg-honey/[0.07]" : "border-line bg-bg2 hover:border-line2"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Avatar hue={c.hue} glyph={c.glyph} size={20} />
              <span className="text-[12px] font-bold text-ink">{c.name}</span>
            </div>
            <div className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${b.cls}`}>{b.label}</div>
            <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-dim">{c.desc}</div>
          </button>
        );
      })}
    </div>
  );
}
