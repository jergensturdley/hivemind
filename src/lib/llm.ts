/**
 * BYOK LLM client — speaks OpenAI-compatible chat completions and the
 * Anthropic messages API, both with SSE streaming.
 */

import { detectProvider } from "@/lib/providers";
import { CODEX_OAUTH } from "@/lib/codex-oauth";

export type LlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  secret: string;
};

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type ModelInfo = { id: string; name: string };

function isMinimax(cfg: { provider: string; baseUrl?: string }): boolean {
  return detectProvider(cfg.provider, cfg.baseUrl).id === "minimax";
}

function baseFor(cfg: LlmConfig): string {
  const p = detectProvider(cfg.provider, cfg.baseUrl);
  const raw = (cfg.baseUrl || p.base || "").replace(/\/+$/, "");
  if (p.id !== "minimax") return raw || p.base;
  const cn = /minimaxi\.com/i.test(raw);
  const host = cn ? "https://api.minimaxi.com" : "https://api.minimax.io";
  if (/\/anthropic/i.test(raw)) return `${host}/anthropic/v1`;
  return `${host}/v1`;
}

/** Stream completion tokens. Yields text deltas. */
export async function* streamChat(
  cfg: LlmConfig,
  msgs: ChatMsg[],
  maxTokens = 1400
): AsyncGenerator<string> {
  if (cfg.provider === "codex") {
    yield* streamCodexResponses(cfg, msgs, maxTokens);
    return;
  }
  if (cfg.provider === "anthropic" && !isMinimax(cfg)) {
    yield* streamAnthropic(cfg, msgs, maxTokens);
    return;
  }
  yield* streamOpenAI(cfg, msgs, maxTokens);
}

/**
 * Codex (ChatGPT sign-in): the backend speaks the Responses API, not chat
 * completions — translate the call and parse its SSE events
 * (response.output_text.delta carries the visible tokens).
 */
function postCodexResponses(cfg: LlmConfig, model: string, msgs: ChatMsg[]): Promise<Response> {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return fetch(`${baseFor(cfg)}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.secret}`,
      originator: "codex_cli_rs",
      "user-agent": `codex_cli_rs/${CODEX_OAUTH.cliVersion}`,
      "session-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model,
      // ChatGPT-plan tokens refuse server-side response storage; the backend
      // 400s ("Store must be set to false") without it. It also rejects
      // max_output_tokens outright, so no token cap is sent — the stream is
      // bounded client-side instead.
      store: false,
      ...(system ? { instructions: system } : {}),
      input: msgs
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
        })),
      stream: true,
    }),
    signal: AbortSignal.timeout(600_000),
  });
}

/** Requested model first, then the provider's ladder — deduped, order kept. */
function codexModelLadder(model: string): string[] {
  return [...new Set([model, ...detectProvider("codex").recommend])];
}

async function* streamCodexResponses(
  cfg: LlmConfig,
  msgs: ChatMsg[],
  maxTokens: number
): AsyncGenerator<string> {
  // OpenAI answers 400 "model not supported" for retired slugs *and* for
  // transient plan-entitlement lag on perfectly good models, so walk the
  // ladder before giving up.
  let res: Response | undefined;
  let errText = "";
  for (const candidate of codexModelLadder(cfg.model)) {
    res = await postCodexResponses(cfg, candidate, msgs);
    if (res.ok) {
      if (candidate !== cfg.model) console.warn(`codex: "${cfg.model}" rejected — using "${candidate}"`);
      break;
    }
    errText = await res.text();
    if (res.status !== 400 || !/not supported/i.test(errText)) break;
  }
  if (!res?.ok || !res.body) {
    throw new Error(`LLM ${res?.status}: ${errText.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: {
        type?: string;
        delta?: string;
        response?: { error?: { message?: string } | string };
      };
      try {
        json = JSON.parse(data) as typeof json;
      } catch {
        continue; // keep-alive or partial chunk
      }
      if (json.type === "response.output_text.delta" && json.delta) {
        yield json.delta;
      } else if (json.type === "response.failed") {
        const err = json.response?.error;
        const msg = typeof err === "string" ? err : err?.message;
        throw new Error(msg ?? "codex response.failed event");
      }
    }
  }
}

async function* streamOpenAI(
  cfg: LlmConfig,
  msgs: ChatMsg[],
  maxTokens: number
): AsyncGenerator<string> {
  const res = await fetch(`${baseFor(cfg)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.secret}`,
      ...(cfg.provider === "openrouter"
        ? { "http-referer": "https://hivemind.local", "x-title": "Hivemind" }
        : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      max_tokens: maxTokens,
      messages: msgs,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const tok = json.choices?.[0]?.delta?.content;
        if (tok) yield tok;
      } catch {
        /* keep-alive chunk */
      }
    }
  }
}

async function* streamAnthropic(
  cfg: LlmConfig,
  msgs: ChatMsg[],
  maxTokens: number
): AsyncGenerator<string> {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = msgs
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch(`${baseFor(cfg)}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.secret,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: rest.length ? rest : [{ role: "user", content: "." }],
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const json = JSON.parse(line.slice(5)) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield json.delta.text;
        }
        if (json.type === "message_stop") return;
      } catch {
        /* ignore */
      }
    }
  }
}

function isLikelyChat(provider: string, id: string): boolean {
  const x = id.toLowerCase();
  if (x.includes("embed") || x.includes("whisper") || x.includes("tts") || x.includes("dall-e") || x.includes("moderation") || x.includes("image") || x.includes("audio") || x.includes("transcribe")) {
    return false;
  }
  return detectProvider(provider).chat.test(x);
}

export function recommendModel(provider: string, models: ModelInfo[]): string | null {
  const chat = models.filter((m) => isLikelyChat(provider, m.id));
  const pool = chat.length ? chat : models;
  for (const needle of detectProvider(provider).recommend) {
    const hit = pool.find((m) => m.id.toLowerCase().includes(needle));
    if (hit) return hit.id;
  }
  return pool[0]?.id ?? null;
}

export function rankModels(provider: string, models: ModelInfo[]): { chat: ModelInfo[]; other: ModelInfo[] } {
  const chat: ModelInfo[] = [];
  const other: ModelInfo[] = [];
  for (const m of models) {
    (isLikelyChat(provider, m.id) ? chat : other).push(m);
  }
  const byId = (a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id);
  return { chat: chat.sort(byId), other: other.sort(byId) };
}

type ModelsAuth = Pick<LlmConfig, "provider" | "baseUrl" | "secret">;

function readJson(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("empty response");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`invalid JSON from provider (${trimmed.slice(0, 120).replace(/\s+/g, " ")})`);
  }
}

function minimaxStatusError(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  const base = rec.base_resp as Record<string, unknown> | undefined;
  const code = Number(base?.status_code ?? rec.status_code ?? 0);
  const msg = String(base?.status_msg ?? rec.status_msg ?? rec.error ?? "");
  if (code && code !== 0) return msg ? `${msg} (${code})` : `minimax error ${code}`;
  if (typeof rec.error === "string" && rec.error) return rec.error;
  if (rec.error && typeof rec.error === "object") {
    const inner = rec.error as Record<string, unknown>;
    const m = String(inner.message ?? inner.msg ?? "");
    if (m) return m;
  }
  return null;
}

function modelsFromUnknown(json: unknown): ModelInfo[] {
  if (Array.isArray(json)) {
    return json
      .map((m) => {
        if (typeof m === "string") return { id: m, name: m };
        if (m && typeof m === "object") {
          const rec = m as Record<string, unknown>;
          const id = String(rec.id ?? rec.name ?? rec.model ?? "");
          return { id, name: String(rec.display_name ?? rec.name ?? id) };
        }
        return { id: "", name: "" };
      })
      .filter((m) => m.id);
  }
  if (!json || typeof json !== "object") return [];
  const rec = json as Record<string, unknown>;
  const data = rec.data ?? rec.models ?? rec.model_list ?? rec.languageModels;
  return modelsFromUnknown(data ?? []);
}

/** Pull the provider's model catalog using the saved key. */
export async function listModels(cfg: ModelsAuth): Promise<ModelInfo[]> {
  const base = baseFor({ ...cfg, model: "" });
  if (!base) throw new Error("Base URL is required to list models.");
  if (isMinimax(cfg)) {
    return listMinimaxModels(base, cfg.secret);
  }
  if (cfg.provider === "anthropic") {
    return listAnthropicModels(base, cfg.secret);
  }
  if (cfg.provider === "codex") {
    // The ChatGPT backend's catalog is best-effort; fall back to known models.
    try {
      return await listCodexModels(base, cfg.secret);
    } catch {
      return detectProvider("codex").fallback;
    }
  }
  return listOpenAiCompatModels(base, cfg);
}

/**
 * The ChatGPT codex backend serves its own catalog shape ({slug,
 * display_name, priority, visibility}) and gates it on the originator +
 * client_version the official CLI sends. Hidden entries are retired/
 * internal models — filter them out, rank by priority (1 = default).
 */
async function listCodexModels(base: string, secret: string): Promise<ModelInfo[]> {
  const res = await fetch(`${base}/models?client_version=${CODEX_OAUTH.cliVersion}`, {
    headers: {
      authorization: `Bearer ${secret}`,
      originator: "codex_cli_rs",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`models ${res.status}: ${text.slice(0, 200)}`);
  const json = readJson(text) as Record<string, unknown> | unknown[];
  const entries = (Array.isArray(json) ? json : (json.data ?? json.models ?? [])) as Record<string, unknown>[];
  const models = entries
    .map((e) => ({
      id: String(e.slug ?? e.id ?? ""),
      name: String(e.display_name ?? e.name ?? e.slug ?? e.id ?? ""),
      priority: Number(e.priority ?? 999),
      visibility: String(e.visibility ?? "list"),
    }))
    .filter((m) => m.id && m.visibility !== "hide")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
  if (!models.length) throw new Error("empty model catalog");
  return models;
}

async function listMinimaxModels(base: string, secret: string): Promise<ModelInfo[]> {
  const openaiBase = base.replace(/\/anthropic\/v1$/, "/v1").replace(/\/v1\/v1$/, "/v1");
  const endpoints = [`${openaiBase}/models`];
  if (base.includes("/anthropic/")) endpoints.push(`${base}/models`);

  let lastErr = "minimax models request failed";
  for (const endpoint of [...new Set(endpoints)]) {
    const res = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = readJson(text);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    const apiErr = minimaxStatusError(json);
    if (apiErr) {
      if (/2049|1004|not authorized|invalid api key|login fail/i.test(apiErr)) {
        throw new Error(apiErr);
      }
      lastErr = apiErr;
      continue;
    }
    const models = modelsFromUnknown(json);
    if (models.length) return models;
    if (res.ok) return detectProvider("minimax").fallback;
    lastErr = `models ${res.status}: ${text.slice(0, 160)}`;
  }
  if (/invalid json|empty response/i.test(lastErr)) return detectProvider("minimax").fallback;
  throw new Error(lastErr);
}

async function listAnthropicModels(base: string, secret: string): Promise<ModelInfo[]> {
  const res = await fetch(`${base}/v1/models?limit=200`, {
    headers: {
      "x-api-key": secret,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const json = readJson(text) as { data?: { id?: string; display_name?: string }[] };
  if (!res.ok) {
    throw new Error(`models ${res.status}: ${text.slice(0, 200)}`);
  }
  return (json.data ?? [])
    .map((m) => ({ id: String(m.id ?? ""), name: String(m.display_name || m.id || "") }))
    .filter((m) => m.id);
}

async function listOpenAiCompatModels(base: string, cfg: ModelsAuth): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.secret}`,
  };
  if (cfg.provider === "openrouter") {
    headers["http-referer"] = "https://hivemind.local";
    headers["x-title"] = "Hivemind";
  }
  const urls = [`${base}/models`];
  if (!base.endsWith("/v1") && !base.endsWith("/openai")) urls.push(`${base}/v1/models`);
  if (detectProvider(cfg.provider, cfg.baseUrl).id === "xai") urls.push(`${base}/language-models`);

  let lastErr = "no models endpoint responded";
  for (const url of urls) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let json: unknown;
    try {
      json = readJson(text);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (!res.ok) {
      lastErr = `models ${res.status}: ${text.slice(0, 200)}`;
      continue;
    }
    const models = modelsFromUnknown(json);
    if (models.length) return models;
    lastErr = "provider returned an empty model list";
  }
  const fallback = detectProvider(cfg.provider, cfg.baseUrl).fallback;
  if (fallback.length && /invalid json|empty response|empty model list/i.test(lastErr)) return fallback;
  throw new Error(lastErr);
}

/** Non-streaming helper (used for the connection test). */
export async function pingModel(cfg: LlmConfig): Promise<string> {
  let out = "";
  try {
    for await (const t of streamChat(
      cfg,
      [
        {
          role: "user",
          content: "Reply with exactly: HIVEMIND_OK",
        },
      ],
      40
    )) {
      out += t;
      if (out.length > 200) break;
    }
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return out || "(empty response)";
}
