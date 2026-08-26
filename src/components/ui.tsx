"use client";

import type { CSSProperties, ReactNode } from "react";
import { STAGES, stageIndex } from "@/lib/agents";
import { stripThink } from "@/lib/think";

/* ---------------- shared class recipes ---------------- */

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey/80 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1";

export const cls = {
  focus,
  btn: `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line2 bg-bg2 px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:border-honey/50 hover:text-honey2 disabled:opacity-40 disabled:pointer-events-none cursor-pointer lg:min-h-0 ${focus}`,
  btnPrimary: `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-honey px-3.5 py-1.5 text-[13px] font-bold text-on-honey transition hover:bg-honey2 disabled:opacity-40 disabled:pointer-events-none cursor-pointer lg:min-h-0 ${focus}`,
  btnGhost: `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-mut transition hover:text-ink cursor-pointer lg:min-h-0 ${focus}`,
  input: `w-full rounded-md border border-line2 bg-bg1 px-3 py-2 text-base text-ink placeholder:text-dim outline-none transition focus:border-honey/60 lg:text-[13px] ${focus}`,
  card: "rounded-lg border border-line bg-bg1",
  chip: "inline-flex items-center gap-1 rounded-full border border-line2 bg-bg2 px-2 py-0.5 text-[11px] font-semibold text-mut",
};

/* ---------------- avatar ---------------- */

export function Avatar({
  hue,
  glyph,
  size = 30,
  speaking = false,
  className = "",
}: {
  hue: number;
  glyph: string;
  size?: number;
  speaking?: boolean;
  className?: string;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.46,
    background: `hsl(${hue} 42% 16%)`,
    color: `hsl(${hue} 88% 68%)`,
    boxShadow: speaking ? `0 0 0 2px hsl(${hue} 88% 60% / 0.55), 0 0 18px hsl(${hue} 88% 60% / 0.35)` : undefined,
  };
  return (
    <div style={style} className={`grid shrink-0 place-items-center rounded-[9px] font-display font-bold ${speaking ? "pulse-soft" : ""} ${className}`}>
      {glyph}
    </div>
  );
}

/* ---------------- stage tracker ---------------- */

export function StageTrack({ stage, compact = false }: { stage: string; compact?: boolean }) {
  const active = stageIndex(stage);
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => {
        const done = i < active || stage === "done";
        const current = i === active && stage !== "done";
        return (
          <div key={s.id} className="flex items-center gap-1" title={s.label}>
            {i > 0 && <div className={`h-px w-2.5 ${done || current ? "bg-honey/50" : "bg-line2"}`} />}
            <div
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap transition ${
                current
                  ? "bg-honey text-on-honey"
                  : done
                    ? "bg-ok/10 text-ok"
                    : "bg-bg2 text-dim border border-line"
              } ${current ? "pulse-soft" : ""}`}
            >
              {compact ? s.short : s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- time helpers ---------------- */

export function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ---------------- markdown ---------------- */

// Chat/workbench markdown renders untrusted content (LLM output, imported
// READMEs), so links are limited to remote, mailto, and relative targets.
const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={k++} className="font-bold text-ink">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={k++} className="rounded border border-line bg-bg2 px-1 py-px font-mono text-[0.85em] text-honey2">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const href = mm?.[2] ?? "#";
      out.push(
        <a key={k++} href={SAFE_HREF.test(href) ? href : "#"} className="text-honey underline decoration-honey/40 underline-offset-2">
          {mm?.[1]}
        </a>
      );
    } else {
      out.push(
        <em key={k++} className="italic text-ink/90">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const KEYWORDS =
  /\b(?:import|export|from|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|interface|type|async|await|try|catch|throw|default|true|false|null|undefined|void|typeof|as|of|in|this|yield|static|readonly|enum|public|private|select|insert|update|delete|where|values|limit|order|by|not|and|or)\b/;

function highlight(code: string, lang: string): ReactNode[] {
  const commentSrc = lang === "md" || lang === "markdown" ? "" : lang === "sh" || lang === "bash" ? "#[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const pattern = new RegExp(
    `(${commentSrc ? commentSrc + "|" : ""}"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(${KEYWORDS.source})|(\\b\\d[\\d_.]*\\b)`,
    "g"
  );
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="text-code-str">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="text-honey">{m[2]}</span>);
    else out.push(<span key={k++} className="text-code-num">{m[3]}</span>);
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-term">
      <div className="flex items-center justify-between border-b border-line bg-bg1 px-3 py-1.5">
        <span className="font-mono text-[11px] text-mut">{title ?? lang ?? "code"}</span>
        <span className="flex gap-1">
          <i className="h-2 w-2 rounded-full bg-line2" />
          <i className="h-2 w-2 rounded-full bg-line2" />
          <i className="h-2 w-2 rounded-full bg-honey/60" />
        </span>
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-code">
        <code>{highlight(code, lang ?? "")}</code>
      </pre>
    </div>
  );
}

function TableBlock({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-bg2">
            {head.map((c, i) => (
              <th key={i} className="border-b border-line px-3 py-1.5 text-left font-bold text-ink">
                {inline(c.trim())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="odd:bg-bg1 even:bg-bg0/60">
              {r.map((c, ci) => (
                <td key={ci} className="border-b border-line/60 px-3 py-1.5 text-mut last:border-r-0">
                  {inline(c.trim())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderLines(text: string, keyBase: string): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `${keyBase}-${k++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // table
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|");
        if (!cells.every((c) => /^[\s:|-]+$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(<TableBlock key={key()} rows={rows} />);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(
        <div
          key={key()}
          className={
            level === 1
              ? "mt-3 mb-1.5 font-display text-[17px] font-bold text-ink"
              : level === 2
                ? "mt-3 mb-1 font-display text-[14.5px] font-bold text-honey2"
                : "mt-2 mb-1 text-[13px] font-bold text-ink"
          }
        >
          {inline(h[2])}
        </div>
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <div key={key()} className="my-1.5 border-l-2 border-honey/50 bg-honey/[0.04] py-1 pl-3 pr-2 text-[12.5px] text-mut">
          {inline(buf.join(" "))}
        </div>
      );
      continue;
    }

    if (/^\s*[-*]\s+\[[ x]\]\s+/.test(line)) {
      const items: { done: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ x]\]\s+/.test(lines[i])) {
        const m2 = lines[i].match(/^\s*[-*]\s+\[([ x])\]\s+(.*)$/);
        if (m2) items.push({ done: m2[1] === "x", text: m2[2] });
        i++;
      }
      out.push(
        <div key={key()} className="my-1.5 space-y-1">
          {items.map((it, ii) => (
            <div key={ii} className="flex items-start gap-2 text-[13px]">
              <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border text-[9px] font-bold ${it.done ? "border-ok/60 bg-ok/15 text-ok" : "border-line2 text-transparent"}`}>
                ✓
              </span>
              <span className={it.done ? "text-mut" : "text-ink"}>{inline(it.text)}</span>
            </div>
          ))}
        </div>
      );
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*•]|\d+\.)\s+/, ""));
        i++;
      }
      out.push(
        <div key={key()} className="my-1.5 space-y-1">
          {items.map((it, ii) => (
            <div key={ii} className="flex items-start gap-2 text-[13px] text-mut">
              <span className="mt-px shrink-0 font-mono text-[11px] leading-5 text-honey">{ordered ? `${ii + 1}.` : "–"}</span>
              <span>{inline(it)}</span>
            </div>
          ))}
        </div>
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push(<hr key={key()} className="my-3 border-line" />);
      i++;
      continue;
    }

    // paragraph — collect until blank/structural line
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|>\s?|\s*[-*•]\s|\s*\d+\.\s|\||```)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(
      <p key={key()} className="my-1 text-[13px] leading-relaxed text-mut">
        {inline(buf.join(" "))}
      </p>
    );
  }
  return out;
}

export function Md({ text }: { text: string }) {
  const parts = stripThink(text).split(/```(\w*)\n?([\s\S]*?)```/g);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) out.push(<div key={`t${i}`}>{renderLines(parts[i], `t${i}`)}</div>);
    if (parts[i + 1] !== undefined) {
      out.push(<CodeBlock key={`c${i}`} lang={parts[i + 1]} code={parts[i + 2] ?? ""} />);
    }
  }
  return <div className="min-w-0">{out}</div>;
}

/* ---------------- misc ---------------- */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line2 border-t-honey ${className}`}
    />
  );
}
