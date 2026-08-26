import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { refreshXaiToken } from "@/lib/xai-oauth";
import { refreshCodexToken } from "@/lib/codex-oauth";
import type { LlmConfig } from "@/lib/llm";

type KeyRow = typeof apiKeys.$inferSelect;

export async function liveSecret(key: KeyRow): Promise<string> {
  if (key.authKind !== "oauth" || !key.refreshToken) return key.secret;
  const refresh =
    key.provider === "xai"
      ? refreshXaiToken
      : key.provider === "codex"
        ? (t: string) => refreshCodexToken(t).then((r) => ({ ...r, refresh_token: r.refresh_token }))
        : null;
  if (!refresh) return key.secret;
  const exp = key.tokenExpiresAt ? key.tokenExpiresAt.getTime() : 0;
  if (exp > Date.now() + 120_000) return key.secret;
  const tokens = await refresh(key.refreshToken);
  const expires = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
  await db
    .update(apiKeys)
    .set({
      secret: tokens.access_token,
      refreshToken: tokens.refresh_token ?? key.refreshToken,
      tokenExpiresAt: expires,
    })
    .where(eq(apiKeys.id, key.id));
  return tokens.access_token;
}

export async function cfgFromKey(key: KeyRow, model = key.model): Promise<LlmConfig> {
  return {
    provider: key.provider,
    baseUrl: key.baseUrl ?? "",
    model,
    secret: await liveSecret(key),
  };
}
