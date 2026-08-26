/** Public Grok CLI OAuth client — device-code login for SuperGrok / X Premium+. */

export const XAI_OAUTH = {
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  scope: "openid profile email offline_access grok-cli:access api:access",
  deviceUrl: "https://auth.x.ai/oauth2/device/code",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  apiBase: "https://api.x.ai/v1",
} as const;

export type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function formPost(url: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
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

export { formPost };

export async function startXaiDevice(): Promise<DeviceStart> {
  const { status, json } = await formPost(XAI_OAUTH.deviceUrl, {
    client_id: XAI_OAUTH.clientId,
    scope: XAI_OAUTH.scope,
  });
  if (!json.device_code || !json.user_code) {
    throw new Error(String(json.error_description || json.error || `device code failed (${status})`));
  }
  return {
    device_code: String(json.device_code),
    user_code: String(json.user_code),
    verification_uri: String(json.verification_uri || "https://auth.x.ai/oauth2/device"),
    verification_uri_complete: json.verification_uri_complete ? String(json.verification_uri_complete) : undefined,
    expires_in: Number(json.expires_in ?? 1800),
    interval: Number(json.interval ?? 5),
  };
}

export type PollResult =
  | { status: "pending"; interval?: number }
  | { status: "ok"; tokens: TokenSet }
  | { status: "error"; error: string };

export async function pollXaiDevice(deviceCode: string): Promise<PollResult> {
  const { json } = await formPost(XAI_OAUTH.tokenUrl, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: XAI_OAUTH.clientId,
  });
  const err = String(json.error ?? "");
  if (err === "authorization_pending") return { status: "pending", interval: Number(json.interval ?? 5) };
  if (err === "slow_down") return { status: "pending", interval: Number(json.interval ?? 8) };
  if (err) return { status: "error", error: String(json.error_description || err) };
  if (!json.access_token) return { status: "pending" };
  return {
    status: "ok",
    tokens: {
      access_token: String(json.access_token),
      refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
      expires_in: json.expires_in != null ? Number(json.expires_in) : 3600,
      token_type: json.token_type ? String(json.token_type) : "Bearer",
    },
  };
}

export async function refreshXaiToken(refreshToken: string): Promise<TokenSet> {
  const { status, json } = await formPost(XAI_OAUTH.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: XAI_OAUTH.clientId,
  });
  if (!json.access_token) {
    throw new Error(String(json.error_description || json.error || `refresh failed (${status})`));
  }
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : refreshToken,
    expires_in: json.expires_in != null ? Number(json.expires_in) : 3600,
  };
}
