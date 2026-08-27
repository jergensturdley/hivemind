/**
 * swarm-cli `doctor` — diagnose and fix whatever keeps the swarm from
 * running live. Applies safe fixes first (retired codex slugs, stale OAuth
 * tokens), then probes every key with a real one-shot call and reports the
 * exact error text, then checks per-agent routing.
 */

import { db } from "@/db";
import { apiKeys, userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cfgFromKey } from "@/lib/key-auth";
import { pingModel } from "@/lib/llm";
import { AGENTS } from "@/lib/agents";
import { providerById } from "@/lib/providers";
import { customHarnessesOf } from "@/lib/harnesses";
import { detectAll } from "@/lib/detect-harness";
import type { TermLine } from "@/lib/events";

const RETIRED_CODEX = new Set(["gpt-5.1-codex", "gpt-5-codex", "gpt-5.3-codex"]);
const CODEX_DEFAULT = "gpt-5.6-sol";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runDoctor(userId: number): Promise<TermLine[]> {
  const lines: TermLine[] = [];
  const say = (text: string, tone?: TermLine["tone"]) => lines.push({ text, tone });
  say("doctor — live-run diagnostics", "ok");

  const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  if (!keys.length) {
    say("✗ no API keys — add one in Settings, then run doctor again", "err");
    return lines;
  }

  let problems = 0;

  // Pass 1 — safe fixes before probing.
  for (const key of keys) {
    if (key.provider === "codex" && (!key.model.trim() || RETIRED_CODEX.has(key.model))) {
      const old = key.model.trim() || "(none)";
      await db.update(apiKeys).set({ model: CODEX_DEFAULT }).where(eq(apiKeys.id, key.id));
      key.model = CODEX_DEFAULT;
      say(`fixed: "${key.label}" model ${old} → ${CODEX_DEFAULT} (retired or missing slug)`, "warn");
    }
    if (key.provider === "codex" && key.authKind === "oauth" && key.refreshToken) {
      const stale = !key.tokenExpiresAt || key.tokenExpiresAt.getTime() < Date.now() + 10 * 60_000;
      if (stale) {
        try {
          await cfgFromKey(key); // refreshes + persists via liveSecret
          say(`fixed: "${key.label}" OAuth access token refreshed`, "ok");
        } catch (e) {
          problems++;
          say(`✗ "${key.label}" token refresh failed: ${msg(e).slice(0, 160)} — sign in again in Settings`, "err");
        }
      }
    }
  }

  // Pass 2 — probe each key with a real one-shot call.
  for (const key of keys) {
    if (!key.model.trim()) {
      problems++;
      say(`✗ "${key.label}" (${providerById(key.provider).label}) has no model — pick one in Settings`, "err");
      continue;
    }
    const started = Date.now();
    try {
      const cfg = await cfgFromKey(key);
      const reply = await pingModel(cfg);
      if (reply.startsWith("error:")) {
        problems++;
        say(`✗ "${key.label}" ${providerById(key.provider).label} · ${key.model} — ${reply.slice("error: ".length, 180)}`, "err");
      } else {
        say(`✓ "${key.label}" ${providerById(key.provider).label} · ${key.model} — live (${Date.now() - started}ms)`, "ok");
      }
    } catch (e) {
      problems++;
      say(`✗ "${key.label}" — ${msg(e).slice(0, 180)}`, "err");
    }
  }

  // Pass 3 — per-agent routing against surviving keys.
  const ready = keys.filter((k) => k.model.trim());
  if (ready.length) {
    const fallback = ready.find((k) => k.isDefault) ?? ready[0];
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const routes = (s?.data as { agents?: Record<string, { keyId?: number; model?: string }> } | null)?.agents;
    for (const a of AGENTS) {
      const route = routes?.[a.id];
      const key = (route?.keyId ? ready.find((k) => k.id === route.keyId) : undefined) ?? fallback;
      const model = route?.model?.trim() || key.model;
      say(`  ${a.glyph} ${a.name.padEnd(8)} → ${key.label} · ${model}`, "dim");
    }
  }

  // Pass 4 — harness bridges: which coding CLIs are actually on PATH here.
  const [settingsForHarness] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const harnesses = await detectAll(customHarnessesOf(settingsForHarness?.data));
  say("coding-agent bridges on this machine", "ok");
  for (const h of harnesses) {
    const state = h.bin
      ? h.installed
        ? `✓ on PATH (${h.binPath})`
        : "◌ off PATH — routing label only"
      : "✓ native";
    say(`  ${h.glyph} ${h.name.padEnd(14)} ${state}${h.custom ? "  · custom" : ""}`, h.installed || !h.bin ? "dim" : "warn");
  }

  say(
    problems
      ? `✗ ${problems} problem${problems > 1 ? "s" : ""} — fix the above and run doctor again`
      : "✓ all keys live — the swarm can run",
    problems ? "err" : "ok"
  );
  return lines;
}
