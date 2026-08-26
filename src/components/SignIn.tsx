"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGENTS } from "@/lib/agents";
import { Avatar, Spinner, cls } from "@/components/ui";

export function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (em: string, nm: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em, name: nm }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not open a session.");
      router.push("/studio");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open a session.");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      {/* brand panel */}
      <div className="grid-noise relative hidden flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-honey/[0.04]" />
        <div className="relative">
          <div className="flex items-center gap-2.5 font-display text-[19px] font-bold text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-honey/15 text-[16px] text-honey">◈</span>
            hivemind
          </div>
        </div>

        <div className="relative max-w-[520px]">
          <h1 className="font-display text-[42px] leading-[1.06] font-bold text-ink">
            One spec in.
            <br />
            A <span className="text-honey">shipped app</span> out.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-mut">
            A swarm of role-specialized agents — orchestrator, PM, architect, engineer, reviewer, QA — plans, debates and
            implements your product in a live group chat. You keep the keys and the final say.
          </p>

          <div className="mt-8 space-y-2.5">
            {[
              ["01", "Paste a single spec — the swarm handles intake → plan → build → review → ship"],
              ["02", "Intervene any time: @mention an agent mid-run and it answers in-thread"],
              ["03", "BYOK: OpenAI / Anthropic compatible, or run the built-in simulation engine"],
            ].map(([n, t]) => (
              <div key={n} className="flex items-start gap-3">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-honey">{n}</span>
                <span className="text-[13px] text-mut">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="mb-2 text-[10px] font-bold tracking-[0.16em] text-dim uppercase">The swarm</div>
          <div className="space-y-2">
            {AGENTS.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border border-line bg-bg1/80 p-2">
                <Avatar hue={a.hue} glyph={a.glyph} size={22} />
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-ink">
                    {a.name} <span className="font-medium text-dim">· {a.role}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-mut">{a.blurb}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* auth panel */}
      <div className="flex items-center justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 lg:hidden">
            <div className="flex items-center gap-2.5 font-display text-[19px] font-bold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-honey/15 text-[16px] text-honey">◈</span>
              hivemind
            </div>
          </div>

          {busy ? (
            <div className={`${cls.card} fade-up p-6`}>
              <div className="flex items-center gap-2.5">
                <Spinner />
                <span className="font-display text-[15px] font-bold text-ink">Opening session…</span>
              </div>
              <p className="mt-2 text-[12.5px] text-mut">A cookie on this machine. Nothing is sent to an identity provider.</p>
            </div>
          ) : (
            <>
              <h1 className="font-display text-[22px] font-bold text-ink">Open a local session</h1>
              <p className="mt-1 text-[13px] text-mut">Hivemind runs on this machine. Name yourself and enter — no SSO, no company account.</p>

              <form
                className="mt-6 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void signIn(email, name);
                }}
              >
                <div>
                  <label htmlFor="display-name" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                    Name
                  </label>
                  <input
                    id="display-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Avery"
                    autoComplete="name"
                    className={cls.input}
                  />
                </div>
                <div>
                  <label htmlFor="session-email" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                    Email
                  </label>
                  <input
                    id="session-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@local.host"
                    className={cls.input}
                  />
                  <p className="mt-1 text-[11px] text-dim">How this machine finds you again. Not a login to anyone else’s service.</p>
                </div>
                {error && (
                  <div role="alert" className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[12px] text-err">
                    {error}
                  </div>
                )}
                <button type="submit" disabled={busy} className={`${cls.btnPrimary} w-full justify-center !py-2.5`}>
                  Enter Hivemind
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
