"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AGENTS } from "@/lib/agents";
import { PROVIDERS, providerById } from "@/lib/providers";
import {
  customHarnessDef,
  type CustomHarnessInput,
} from "@/lib/harnesses";
import { Avatar, Spinner, cls } from "@/components/ui";
import { Shell } from "@/components/Shell";
import { HarnessGrid } from "@/components/HarnessGrid";

type KeyRow = {
  id: number;
  provider: string;
  label: string;
  baseUrl: string | null;
  model: string;
  secretMasked: string;
  authKind?: string;
  isDefault: boolean;
};

type AgentRoute = { keyId?: number; model?: string };

type SettingsData = {
  cliAgent?: string;
  agents?: Record<string, AgentRoute>;
  customHarnesses?: CustomHarnessInput[];
};

type ModelInfo = { id: string; name: string };

type Catalog = {
  loading: boolean;
  error: string | null;
  chat: ModelInfo[];
  other: ModelInfo[];
  recommended: string | null;
};

export function SettingsClient({ user }: { user: { id: number; name: string; email: string; hue: number } }) {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [settings, setSettings] = useState<SettingsData>({});
  const [booted, setBooted] = useState(false);

  // key form
  const [provider, setProvider] = useState<string>("openai");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState<string>(PROVIDERS[0]?.base ?? "https://api.openai.com/v1");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testByKey, setTestByKey] = useState<Record<number, { ok: boolean; reply: string }>>({});
  const [catalogs, setCatalogs] = useState<Record<number, Catalog>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [xaiFlow, setXaiFlow] = useState<{
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    device_code: string;
    interval: number;
  } | null>(null);
  const [codexFlow, setCodexFlow] = useState<{
    user_code: string;
    verification_uri: string;
    device_code: string;
    interval: number;
  } | null>(null);

  // custom bridge form
  const [chName, setChName] = useState("");
  const [chBin, setChBin] = useState("");
  const [chTemplate, setChTemplate] = useState("");

  const loadCatalog = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/keys/${id}/models`);
      const data = (await res.json()) as {
        chat?: ModelInfo[];
        other?: ModelInfo[];
        recommended?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setCatalogs((c) => ({
          ...c,
          [id]: { loading: false, error: data.error ?? "Could not list models", chat: [], other: [], recommended: null },
        }));
        return;
      }
      setCatalogs((c) => ({
        ...c,
        [id]: {
          loading: false,
          error: null,
          chat: data.chat ?? [],
          other: data.other ?? [],
          recommended: data.recommended ?? null,
        },
      }));
    } catch {
      setCatalogs((c) => ({
        ...c,
        [id]: { loading: false, error: "network error", chat: [], other: [], recommended: null },
      }));
    }
  }, []);

  const load = useCallback(async () => {
    const [k, s] = await Promise.all([
      fetch("/api/keys").then((r) => r.json() as Promise<{ keys: KeyRow[] }>),
      fetch("/api/settings").then((r) => r.json() as Promise<{ data: SettingsData }>),
    ]);
    setKeys(k.keys);
    setSettings(s.data ?? {});
    setBooted(true);
    await Promise.all((k.keys ?? []).map((row) => loadCatalog(row.id)));
  }, [loadCatalog]);

  const flash = (msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(null), 2200);
  };

  const refreshCatalog = (id: number) => {
    setCatalogs((c) => ({
      ...c,
      [id]: {
        loading: true,
        error: null,
        chat: c[id]?.chat ?? [],
        other: c[id]?.other ?? [],
        recommended: c[id]?.recommended ?? null,
      },
    }));
    void loadCatalog(id);
  };

  useEffect(() => {
    // Fetch-on-mount; every setState inside `load` settles after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    const verifier = sessionStorage.getItem("or_pkce") ?? "";
    sessionStorage.removeItem("or_pkce");
    window.history.replaceState({}, "", "/settings");
    void (async () => {
      const res = await fetch("/api/keys/oauth/openrouter/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        flash(data.error ?? "OpenRouter sign-in failed");
        return;
      }
      flash("OpenRouter connected — polling models…");
      await load();
      refreshCatalog(data.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!xaiFlow) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await fetch("/api/keys/oauth/xai/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: xaiFlow.device_code }),
      });
      const data = (await res.json()) as { status?: string; id?: number; error?: string; interval?: number };
      if (stop) return;
      if (data.status === "ok" && data.id) {
        setXaiFlow(null);
        flash("Grok signed in — polling models…");
        await load();
        refreshCatalog(data.id);
        return;
      }
      if (data.status === "error") {
        flash(data.error ?? "Grok sign-in failed");
        setXaiFlow(null);
        return;
      }
      timer = setTimeout(tick, Math.max(3, data.interval ?? xaiFlow.interval) * 1000);
    };
    timer = setTimeout(tick, Math.max(3, xaiFlow.interval) * 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xaiFlow?.device_code]);

  useEffect(() => {
    if (!codexFlow) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await fetch("/api/keys/oauth/codex/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: codexFlow.device_code, user_code: codexFlow.user_code }),
      });
      const data = (await res.json()) as { status?: string; id?: number; error?: string; interval?: number };
      if (stop) return;
      if (data.status === "ok" && data.id) {
        setCodexFlow(null);
        flash("Codex signed in — pick a model to go live");
        await load();
        refreshCatalog(data.id);
        return;
      }
      if (data.status === "error") {
        flash(data.error ?? "Codex sign-in failed");
        setCodexFlow(null);
        return;
      }
      timer = setTimeout(tick, Math.max(3, data.interval ?? codexFlow.interval) * 1000);
    };
    timer = setTimeout(tick, Math.max(3, codexFlow.interval) * 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codexFlow?.device_code]);

  const saveSettings = async (patch: SettingsData) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        flash("Could not save settings");
        return;
      }
      setSettings((s) => ({ ...s, ...patch }));
    } catch {
      flash("Network error — settings not saved");
    }
  };

  const testSavedKey = async (id: number, model?: string) => {
    setTestingId(id);
    try {
      const res = await fetch("/api/keys/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId: id, model }),
      });
      const data = (await res.json()) as { ok: boolean; reply?: string; error?: string };
      setTestByKey((t) => ({ ...t, [id]: { ok: data.ok, reply: data.reply ?? data.error ?? "" } }));
    } catch {
      setTestByKey((t) => ({ ...t, [id]: { ok: false, reply: "network error" } }));
    } finally {
      setTestingId(null);
    }
  };

  const patchKey = async (id: number, patch: { model?: string; isDefault?: boolean }) => {
    await fetch("/api/keys", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await load();
  };

  const addKey = async () => {
    if (!secret.trim()) return;
    if (provider === "custom" && !baseUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, label, baseUrl, secret }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        flash(data.error ?? "Could not save key");
        return;
      }
      setSecret("");
      setLabel("");
      flash("Key saved — polling models…");
      await load();
      refreshCatalog(data.id);
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (id: number) => {
    await fetch("/api/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    void load();
  };

  const startXai = async () => {
    const res = await fetch("/api/keys/oauth/xai/start", { method: "POST" });
    const data = (await res.json()) as {
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      device_code?: string;
      interval?: number;
      error?: string;
    };
    if (!res.ok || !data.device_code || !data.user_code) {
      flash(data.error ?? "Could not start Grok sign-in");
      return;
    }
    setXaiFlow({
      user_code: data.user_code,
      verification_uri: data.verification_uri ?? "https://auth.x.ai/oauth2/device",
      verification_uri_complete: data.verification_uri_complete,
      device_code: data.device_code,
      interval: data.interval ?? 5,
    });
  };

  const startCodex = async () => {
    const res = await fetch("/api/keys/oauth/codex/start", { method: "POST" });
    const data = (await res.json()) as {
      user_code?: string;
      verification_uri?: string;
      device_code?: string;
      interval?: number;
      error?: string;
    };
    if (!res.ok || !data.device_code || !data.user_code) {
      flash(data.error ?? "Could not start Codex sign-in");
      return;
    }
    setCodexFlow({
      user_code: data.user_code,
      verification_uri: data.verification_uri ?? "https://auth.openai.com/codex/device",
      device_code: data.device_code,
      interval: data.interval ?? 5,
    });
  };

  const startOpenRouter = async () => {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const verifier = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    sessionStorage.setItem("or_pkce", verifier);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const cb = `${window.location.origin}/settings`;
    window.location.assign(
      `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`
    );
  };

  const canSave = Boolean(secret.trim()) && (provider !== "custom" || Boolean(baseUrl.trim()));
  const selectedProvider = providerById(provider);
  const defaultKey = keys.find((k) => k.isDefault) ?? keys[0];
  const defaultCatalog = defaultKey ? catalogs[defaultKey.id] : undefined;
  const uniqueReadyProviders = (() => {
    const seen = new Set<string>();
    const out: KeyRow[] = [];
    for (const k of keys) {
      if (!k.model.trim() || seen.has(k.provider)) continue;
      seen.add(k.provider);
      out.push(k);
    }
    return out;
  })();

  if (!booted) {
    return (
      <Shell user={user}>
        <div className="grid h-60 place-items-center">
          <Spinner />
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={user}>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-display text-[26px] font-bold text-ink">Settings</h1>
        <p className="mt-1 text-[13.5px] text-mut">Keys, harness preference, and who you are on this machine.</p>

        {savedFlash && (
          <div
            role="status"
            className={`fade-up fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-50 rounded-lg border bg-bg1 px-4 py-2.5 text-[13px] font-semibold shadow-xl ${
              /not saved|could not/i.test(savedFlash) ? "border-err/40 text-err" : "border-ok/40 text-ok"
            }`}
          >
            {savedFlash}
          </div>
        )}

        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          {/* BYOK */}
          <section className={`${cls.card} p-5 lg:col-span-2`}>
            <h2 className="font-display text-[16px] font-bold text-ink">Bring your own keys</h2>
            <p className="mt-1 text-[12.5px] text-mut">
              Save a key, we poll that provider for models, then you pick one. Keys stay in this machine’s database and are
              only used server-side. Without a selected model, missions cannot run — the terminal’s `doctor` command
              diagnoses and fixes whatever blocks a live run.
            </p>

            {keys.length > 0 && (
              <div className="mt-4 space-y-2">
                {keys.map((k) => {
                  const cat = catalogs[k.id];
                  const test = testByKey[k.id];
                  return (
                    <div key={k.id} className="rounded-lg border border-line bg-bg2 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${k.isDefault ? "bg-honey/15 text-honey" : "bg-bg3 text-dim"}`}>
                          {k.provider}
                        </span>
                        <span className="text-[13px] font-bold text-ink">{k.label}</span>
                        <span className="font-mono text-[11px] text-dim">{k.secretMasked}</span>
                        {k.authKind === "oauth" && <span className="text-[10.5px] font-bold text-honey">OAuth</span>}
                        {k.isDefault && <span className="text-[10.5px] font-bold text-ok">DEFAULT — powers the swarm</span>}
                        <button
                          type="button"
                          onClick={() => void removeKey(k.id)}
                          className={`ml-auto inline-flex min-h-11 items-center rounded-md text-[12px] text-mut transition hover:text-err cursor-pointer ${cls.focus}`}
                        >
                          remove
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ModelPicker
                          name={`${k.label} model`}
                          value={k.model}
                          catalog={cat}
                          onChange={(id) => {
                            void patchKey(k.id, { model: id }).then(() => flash(`${k.label} → ${id}`));
                          }}
                          onRefresh={() => refreshCatalog(k.id)}
                        />
                        {cat?.recommended && !k.model && (
                          <button
                            onClick={() => {
                              const id = cat.recommended;
                              if (!id) return;
                              void patchKey(k.id, { model: id }).then(() => flash(`${k.label} → ${id}`));
                            }}
                            className={cls.btn}
                          >
                            Use {cat.recommended}
                          </button>
                        )}
                        {!k.isDefault && (
                          <button
                            type="button"
                            onClick={() => {
                              void patchKey(k.id, { isDefault: true }).then(() => flash(`${k.label} is default — Atlas routes the swarm here`));
                            }}
                            disabled={!k.model.trim()}
                            title={k.model.trim() ? "Atlas and every un-routed agent speak through this key" : "Pick a model first — the swarm cannot run without one"}
                            className={cls.btn}
                          >
                            ★ Use as default
                          </button>
                        )}
                        <button
                          onClick={() => void testSavedKey(k.id)}
                          disabled={!k.model || testingId === k.id}
                          className={cls.btn}
                        >
                          {testingId === k.id ? <Spinner /> : "⚡"} Test
                        </button>
                      </div>
                      {test && (
                        <div className={`mt-2 rounded-md border px-3 py-2 font-mono text-[11.5px] ${test.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-err/40 bg-err/10 text-err"}`}>
                          {test.ok ? `✓ ${test.reply.slice(0, 80)}` : `✗ ${test.reply.slice(0, 160)}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">Provider</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={provider === p.id}
                        onClick={() => {
                          setProvider(p.id);
                          setBaseUrl(p.base);
                        }}
                        className={`min-h-11 rounded-md border px-2.5 py-1.5 text-[12px] font-bold transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                          provider === p.id ? "border-honey/60 bg-honey/10 text-honey" : "border-line bg-bg2 text-mut hover:text-ink"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="key-label" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                    Label
                  </label>
                  <input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="prod key" className={cls.input} />
                </div>
                <div>
                  <label htmlFor="key-base" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                    Base URL
                  </label>
                  <input
                    id="key-base"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className={`${cls.input} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="key-secret" className="mb-1 block text-[11px] font-bold tracking-wide text-mut uppercase">
                    API key
                  </label>
                  <input
                    id="key-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                    className={`${cls.input} font-mono`}
                  />
                </div>
              </div>

              <div className="flex flex-col rounded-lg border border-line bg-bg0/60 p-4">
                {selectedProvider.oauth === "xai-device" && (
                  <DeviceLoginPanel
                    flow={xaiFlow}
                    onStart={() => void startXai()}
                    onCancel={() => setXaiFlow(null)}
                    description="Best path for Grok: sign in with SuperGrok or X Premium+. Uses the same device-code flow as the official Grok CLI — no console key to copy."
                    buttonLabel="Sign in with Grok"
                    footerNote="Or paste a key from console.x.ai below."
                  />
                )}
                {selectedProvider.oauth === "codex-device" && (
                  <DeviceLoginPanel
                    flow={codexFlow}
                    onStart={() => void startCodex()}
                    onCancel={() => setCodexFlow(null)}
                    description="Sign in with your ChatGPT account — the same device-code flow as `codex login --device-auth`. Plus and Pro plans can run Codex models with no API key."
                    buttonLabel="Sign in with ChatGPT (Codex)"
                    footerNote="Or use a platform API key under the OpenAI provider below."
                  />
                )}
                {selectedProvider.oauth === "openrouter-pkce" && (
                  <div className="mb-4">
                    <p className="text-[12.5px] leading-relaxed text-mut">
                      Connect OpenRouter with a browser login. You get a user-controlled key without leaving Hivemind.
                    </p>
                    <button onClick={() => void startOpenRouter()} className={`${cls.btnPrimary} mt-3`}>
                      Connect OpenRouter
                    </button>
                    <p className="mt-3 text-[11px] text-dim">Or paste an existing sk-or- key below.</p>
                  </div>
                )}
                {selectedProvider.oauth !== "xai-device" && selectedProvider.oauth !== "openrouter-pkce" && selectedProvider.oauth !== "codex-device" && (
                  <ol className="list-decimal space-y-2 pl-4 text-[12.5px] leading-relaxed text-mut">
                    <li>
                      <b className="text-ink">Save the key</b> — it never leaves this machine.
                    </li>
                    <li>
                      <b className="text-ink">We poll models</b> from the provider&apos;s native catalog.
                    </li>
                    <li>
                      <b className="text-ink">Select a model</b> — the swarm cannot run until you do.
                    </li>
                  </ol>
                )}
                <div className="mt-auto flex gap-2 pt-4">
                  <button onClick={() => void addKey()} disabled={saving || !canSave} className={cls.btnPrimary}>
                    {saving ? <Spinner /> : null}
                    Save key
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* CLI bridge */}
          <section className={`${cls.card} p-5`}>
            <h2 className="font-display text-[16px] font-bold text-ink">Preferred worker Atlas starts with</h2>
            <p className="mt-1 text-[12.5px] text-mut">
              Atlas dispatches implementation across coding harnesses and rotates from this preference. Spec, architecture, critique, review, and QA always return to Hivemind Native — they never run outbound.
              <span className="block mt-1 text-dim">
                PATH probes are live on this machine — &quot;on PATH&quot; means the CLI binary was found. Hivemind Native is always the hub.
              </span>
            </p>
            <div className="mt-3">
              <HarnessGrid
                layout="list"
                value={settings.cliAgent ?? "hive"}
                onChange={(id: string) => {
                  void saveSettings({ cliAgent: id });
                  flash(`Bridge set to ${id}`);
                }}
              />
            </div>
          </section>

          {/* Custom bridges */}
          <section className={`${cls.card} p-5`}>
            <h2 className="font-display text-[16px] font-bold text-ink">Custom bridges</h2>
            <p className="mt-1 text-[12.5px] text-mut">
              Add a coding agent that isn&apos;t in the preset list. Set the binary name so Hivemind can probe
              PATH and tell you whether it&apos;s installed; the command template is what gets printed for you to run.
            </p>
            {(settings.customHarnesses ?? []).length > 0 && (
              <div className="mt-3 space-y-2">
                {(settings.customHarnesses ?? []).map((c, i) => {
                  const def = customHarnessDef(c);
                  return (
                    <div key={def.id || i} className="flex items-center gap-3 rounded-lg border border-line bg-bg2 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-ink">{def.name}</span>
                          <span className="font-mono text-[10px] text-dim">{def.id}</span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-dim">$ {def.template}</span>
                      </span>
                      <button
                        type="button"
                        className={`${cls.btn} shrink-0`}
                        onClick={() => {
                          const next = (settings.customHarnesses ?? []).filter((_, j) => j !== i);
                          void saveSettings({ customHarnesses: next });
                          flash(`Removed ${def.name}`);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr]">
              <input className={cls.input} placeholder="Bridge name (e.g. Trae)" value={chName} onChange={(e) => setChName(e.target.value)} />
              <input className={cls.input} placeholder="Binary on PATH (optional, e.g. trae)" value={chBin} onChange={(e) => setChBin(e.target.value)} />
              <input
                className={`${cls.input} sm:col-span-2`}
                placeholder='Command template (optional, use {task} — e.g. trae "run {task}")'
                value={chTemplate}
                onChange={(e) => setChTemplate(e.target.value)}
              />
            </div>
            <button
              type="button"
              className={`${cls.btnPrimary} mt-2`}
              disabled={!chName.trim()}
              onClick={() => {
                const def = customHarnessDef({ name: chName, bin: chBin, template: chTemplate });
                const exists = (settings.customHarnesses ?? []).some((c) => customHarnessDef(c).id === def.id);
                if (exists) {
                  flash(`A bridge named ${def.name} already exists`);
                  return;
                }
                const next = [...(settings.customHarnesses ?? []), { id: def.id, name: chName.trim(), bin: chBin.trim(), template: chTemplate.trim() }];
                void saveSettings({ customHarnesses: next });
                setChName("");
                setChBin("");
                setChTemplate("");
                flash(`Added custom bridge ${def.name}`);
              }}
            >
              + Add custom bridge
            </button>
          </section>

          {/* Agent overrides */}
          <section className={`${cls.card} p-5 lg:col-span-2`}>
            <h2 className="font-display text-[16px] font-bold text-ink">Agent roster</h2>
            <p className="mt-1 text-[12.5px] text-mut">
              Give each specialist its own provider and model so the swarm is not six copies of the same brain. Empty = the default key. Atlas still dispatches implementation harnesses; these routes are the LLM each role speaks with.
            </p>
            {uniqueReadyProviders.length >= 2 && (
              <button
                onClick={() => {
                  const agents: Record<string, AgentRoute> = {};
                  AGENTS.forEach((a, i) => {
                    const k = uniqueReadyProviders[i % uniqueReadyProviders.length];
                    if (!k) return;
                    agents[a.id] = { keyId: k.id, model: k.model };
                  });
                  void saveSettings({ agents });
                  flash(`Roster spread across ${uniqueReadyProviders.length} providers`);
                }}
                className={`${cls.btn} mt-3`}
              >
                Spread providers across roster
              </button>
            )}
            <div className="mt-3 space-y-3">
              {AGENTS.map((a) => {
                const route = settings.agents?.[a.id] ?? {};
                const bound = route.keyId ? keys.find((k) => k.id === route.keyId) : defaultKey;
                const catalog = bound ? catalogs[bound.id] : defaultCatalog;
                return (
                  <div key={a.id} className="rounded-lg border border-line bg-bg2 p-3">
                    <div className="flex items-start gap-3">
                      <Avatar hue={a.hue} glyph={a.glyph} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[14px] font-bold text-ink">{a.name}</div>
                            <div className="text-[11px] font-bold tracking-wide text-honey uppercase">{a.role}</div>
                            <div className="mt-1 font-mono text-[11px] text-mut">
                              {(bound?.label || bound?.provider || "no key")} · {route.model || bound?.model || "unassigned"}
                            </div>
                          </div>
                          <div className="flex min-w-0 w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                            <KeyPicker
                              value={route.keyId}
                              keys={keys}
                              defaultKey={defaultKey}
                              agentName={a.name}
                              onPick={(keyId, k) => {
                                void saveSettings({
                                  agents: {
                                    ...(settings.agents ?? {}),
                                    [a.id]: { keyId, model: k?.model ?? "" },
                                  },
                                });
                                flash(`${a.name} → ${k ? `${k.label} / ${k.model}` : "default key"}`);
                              }}
                            />
                            <ModelPicker
                              name={`${a.name} model`}
                              value={route.model ?? ""}
                              catalog={catalog}
                              emptyLabel={bound?.model ? `key default (${bound.model})` : "default model"}
                              onChange={(id) => {
                                void saveSettings({
                                  agents: { ...(settings.agents ?? {}), [a.id]: { ...route, model: id } },
                                });
                                flash(`${a.name} → ${id || bound?.model || "default model"}`);
                              }}
                              onRefresh={bound ? () => refreshCatalog(bound.id) : undefined}
                              compact
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-mut">{a.blurb}</p>
                        <p className="mt-2 text-[12px] leading-relaxed text-dim">{a.prompt}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`${cls.card} p-5 lg:col-span-2`}>
            <h2 className="font-display text-[16px] font-bold text-ink">You</h2>
            <div className="mt-3 rounded-lg border border-line bg-bg2 p-4">
              <div className="flex items-center gap-3">
                <Avatar hue={user.hue} glyph={user.name[0]?.toUpperCase() ?? "U"} size={34} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-ink">{user.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-mut">{user.email}</div>
                </div>
                <span className="ml-auto shrink-0 rounded-full border border-line bg-bg3 px-2 py-0.5 text-[10px] font-bold text-mut">
                  Local session
                </span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
                A cookie on this machine. Sign out from the header. There is no identity provider and no company account.
              </p>
            </div>
          </section>
        </div>
      </main>
    </Shell>
  );
}

/** Combobox for binding an agent to a saved key (default when nothing is picked). */
function KeyPicker({
  value,
  keys,
  defaultKey,
  agentName,
  onPick,
}: {
  value: number | undefined;
  keys: KeyRow[];
  defaultKey: KeyRow | undefined;
  agentName: string;
  onPick: (keyId: number | undefined, k: KeyRow | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const ready = keys.filter((k) => k.model.trim()).slice(0, 20);
  const current = value ? keys.find((k) => k.id === value) : undefined;
  const label = current ? `${current.label} · ${current.model}` : `Default key${defaultKey ? ` (${defaultKey.label})` : ""}`;

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${agentName} provider`}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line bg-bg1 px-2.5 py-1.5 text-left transition hover:border-line2 cursor-pointer lg:min-h-0 ${cls.focus}`}
      >
        <span className="truncate font-mono text-[12px] text-ink">{label}</span>
        <span className="text-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={`${agentName} key`}
          className="absolute z-30 mt-1 max-h-56 w-full min-w-[260px] overflow-y-auto rounded-md border border-line bg-bg1 py-1 shadow-xl"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                onPick(undefined, undefined);
              }}
              className={`flex min-h-11 w-full items-center px-3 py-1.5 text-left font-mono text-[12px] transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                !value ? "bg-honey/10 text-honey" : "text-mut hover:bg-bg2 hover:text-ink"
              }`}
            >
              Default key{defaultKey ? ` (${defaultKey.label})` : ""}
            </button>
          </li>
          {ready.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === k.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onPick(k.id, k);
                }}
                className={`flex min-h-11 w-full items-center truncate px-3 py-1.5 text-left font-mono text-[12px] transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                  value === k.id ? "bg-honey/10 text-honey" : "text-mut hover:bg-bg2 hover:text-ink"
                }`}
              >
                {k.label} · {k.provider} · {k.model}
              </button>
            </li>
          ))}
          {!ready.length && <li className="px-3 py-2 text-[11px] text-dim">No ready keys — add one above.</li>}
        </ul>
      )}
    </div>
  );
}

/** Shared device-code sign-in panel (Grok + Codex flows). */
function DeviceLoginPanel({
  flow,
  onStart,
  onCancel,
  description,
  buttonLabel,
  footerNote,
}: {
  flow: { user_code: string; verification_uri: string; verification_uri_complete?: string } | null;
  onStart: () => void;
  onCancel: () => void;
  description: string;
  buttonLabel: string;
  footerNote: string;
}) {
  return (
    <div className="mb-4">
      <p className="text-[12.5px] leading-relaxed text-mut">{description}</p>
      {flow ? (
        <div className="mt-3 rounded-md border border-honey/40 bg-honey/[0.07] p-3">
          <div className="text-[11px] font-bold tracking-wide text-mut uppercase">Waiting for approval</div>
          <a
            href={flow.verification_uri_complete || flow.verification_uri}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-[12.5px] text-honey underline"
          >
            {flow.verification_uri}
          </a>
          <div className="mt-2 font-mono text-[22px] font-bold tracking-[0.2em] text-ink">{flow.user_code}</div>
          <button onClick={onCancel} className={`${cls.btn} mt-3`}>
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={onStart} className={`${cls.btnPrimary} mt-3`}>
          {buttonLabel}
        </button>
      )}
      <p className="mt-3 text-[11px] text-dim">{footerNote}</p>
    </div>
  );
}

function ModelPicker({
  value,
  catalog,
  onChange,
  onRefresh,
  emptyLabel = "Select a model…",
  compact = false,
  name = "Model",
}: {
  value: string;
  catalog: Catalog | undefined;
  onChange: (id: string) => void;
  onRefresh?: () => void;
  emptyLabel?: string;
  compact?: boolean;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const rec = catalog?.recommended ?? null;
  const loading = catalog?.loading ?? (catalog === undefined && Boolean(onRefresh));
  const err = catalog?.error;
  const all = useMemo(() => {
    const rows: ModelInfo[] = [];
    if (rec) rows.push({ id: rec, name: `★ ${rec}` });
    for (const m of catalog?.chat ?? []) if (m.id !== rec) rows.push(m);
    for (const m of catalog?.other ?? []) if (m.id !== rec) rows.push({ id: m.id, name: m.id });
    return rows;
  }, [catalog, rec]);
  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    const filtered = needle
      ? all.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      : all;
    const rows = filtered.slice(0, 40);
    if (!value || needle) return rows;
    const current = all.find((m) => m.id === value);
    if (current && !rows.some((m) => m.id === value)) return [current, ...rows.slice(0, 39)];
    return rows;
  }, [all, needle, value]);
  const hidden = Math.max(0, (needle ? all.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)).length : all.length) - matches.length);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
    setHi(0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = matches[hi];
      if (open && hit) pick(hit.id);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (loading && all.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-mut">
        <Spinner /> polling models…
      </span>
    );
  }
  if (err && all.length === 0) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model id (manual)"
          aria-label={name}
          aria-invalid
          className={`${cls.input} w-52 font-mono lg:text-[11px]`}
        />
        <span className="max-w-[220px] truncate text-[11px] text-err" title={err}>
          {err}
        </span>
      </span>
    );
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${compact ? "w-full sm:w-56" : "flex-1"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <input
          value={open ? q : value}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => {
            setOpen(true);
            setQ("");
          }}
          onKeyDown={onKey}
          placeholder={value || emptyLabel}
          aria-label={name}
          aria-expanded={open}
          aria-controls={`${name.replace(/\s+/g, "-")}-list`}
          role="combobox"
          autoComplete="off"
          className={`${cls.input} min-w-0 flex-1 font-mono ${compact ? "sm:text-[11.5px]" : ""}`}
        />
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={loading} className={cls.btn} aria-label="Refresh model list">
            {loading ? <Spinner /> : "↻"}
          </button>
        )}
      </div>
      {open && (
        <ul
          id={`${name.replace(/\s+/g, "-")}-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-bg1 py-1 shadow-xl"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`flex min-h-11 w-full px-3 py-1.5 text-left font-mono text-[12px] transition cursor-pointer lg:min-h-0 ${cls.focus} ${!value ? "bg-honey/10 text-honey" : "text-mut hover:bg-bg2 hover:text-ink"}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("")}
            >
              {emptyLabel}
            </button>
          </li>
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === m.id}
                className={`flex min-h-11 w-full truncate px-3 py-1.5 text-left font-mono text-[12px] transition cursor-pointer lg:min-h-0 ${cls.focus} ${
                  i === hi ? "bg-bg3 text-ink" : value === m.id ? "text-honey" : "text-mut hover:bg-bg2 hover:text-ink"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m.id)}
              >
                {m.name !== m.id ? `${m.id} — ${m.name}` : m.name}
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-3 py-1.5 font-mono text-[11px] text-dim">Keep typing — {hidden} more</li>
          )}
          {matches.length === 0 && <li className="px-3 py-1.5 font-mono text-[11px] text-dim">No models match</li>}
        </ul>
      )}
    </div>
  );
}
