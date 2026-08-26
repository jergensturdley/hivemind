/**
 * OpenAI Codex login — the same device-code flow `codex login --device-auth`
 * uses (public Codex CLI client), yielding ChatGPT-plan tokens that speak the
 * Responses API at chatgpt.com/backend-api/codex.
 *
 * Flow: POST {issuer}/api/accounts/deviceauth/usercode → user visits
 * {issuer}/codex/device and enters the code → poll …/deviceauth/token until it
 * returns an authorization_code + PKCE verifier → exchange at {issuer}/oauth/token.
 *
 * Both hosts can be overridden (self-hosted/proxy/test) via env.
 */

import { formPost } from "@/lib/xai-oauth";

export const CODEX_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  issuer: process.env.CODEX_AUTH_ISSUER?.replace(/\/+$/, "") || "https://auth.openai.com",
  apiBase: process.env.CODEX_API_BASE?.replace(/\/+$/, "") || "https://chatgpt.com/backend-api/codex",
  // Emulated CLI version — the models endpoint gates its catalog on it and
  // the backend expects a codex_cli_rs/{version} user agent.
  cliVersion: "0.149.1",
} as const;

export type CodexDeviceStart = {
  device_code: string; // device_auth_id
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

async function jsonPost(url: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: "invalid_json", error_description: text.slice(0, 180) };
  }
  return { status: res.status, json };
}

export async function startCodexDevice(): Promise<CodexDeviceStart> {
  const { status, json } = await jsonPost(`${CODEX_OAUTH.issuer}/api/accounts/deviceauth/usercode`, {
    client_id: CODEX_OAUTH.clientId,
  });
  if (!json.device_auth_id || !json.user_code) {
    throw new Error(String(json.error_description || json.error || `device code request failed (${status})`));
  }
  return {
    device_code: String(json.device_auth_id),
    user_code: String(json.user_code),
    verification_uri: `${CODEX_OAUTH.issuer}/codex/device`,
    expires_in: Number(json.expires_in ?? 900),
    interval: Math.max(1, Number(json.interval ?? 5)),
  };
}

export type CodexPollResult =
  | { status: "pending"; interval?: number }
  | { status: "ok"; tokens: { access_token: string; refresh_token: string; expires_in?: number } }
  | { status: "error"; error: string };

/** One poll of the device token endpoint; on success, immediately exchange the code for tokens. */
export async function pollCodexDevice(deviceAuthId: string, userCode: string): Promise<CodexPollResult> {
  const { status, json } = await jsonPost(`${CODEX_OAUTH.issuer}/api/accounts/deviceauth/token`, {
    device_auth_id: deviceAuthId,
    user_code: userCode,
  });
  // 403/404 mean "not approved yet" in this flow — keep polling.
  if (status === 403 || status === 404) return { status: "pending" };
  if (!json.authorization_code || !json.code_verifier) {
    return { status: "error", error: String(json.error_description || json.error || `device token poll failed (${status})`) };
  }

  const exchange = await formPost(`${CODEX_OAUTH.issuer}/oauth/token`, {
    grant_type: "authorization_code",
    code: String(json.authorization_code),
    redirect_uri: `${CODEX_OAUTH.issuer}/deviceauth/callback`,
    client_id: CODEX_OAUTH.clientId,
    code_verifier: String(json.code_verifier),
  });
  if (!exchange.json.access_token || !exchange.json.refresh_token) {
    return {
      status: "error",
      error: String(exchange.json.error_description || exchange.json.error || `token exchange failed (${exchange.status})`),
    };
  }
  return {
    status: "ok",
    tokens: {
      access_token: String(exchange.json.access_token),
      refresh_token: String(exchange.json.refresh_token),
      expires_in: exchange.json.expires_in != null ? Number(exchange.json.expires_in) : undefined,
    },
  };
}

export async function refreshCodexToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in?: number }> {
  const { status, json } = await formPost(`${CODEX_OAUTH.issuer}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CODEX_OAUTH.clientId,
  });
  if (!json.access_token) {
    throw new Error(String(json.error_description || json.error || `codex refresh failed (${status})`));
  }
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : refreshToken,
    expires_in: json.expires_in != null ? Number(json.expires_in) : undefined,
  };
}
