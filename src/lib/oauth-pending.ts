/**
 * Device-login pending state, persisted in userSettings so a server
 * restart doesn't kill an in-flight device flow. Keyed per flow (xai, codex).
 */
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export type DeviceFlow = "xai" | "codex";

type DeviceRow = { deviceCode: string; expiresAt: number };

async function readData(userId: number): Promise<Record<string, unknown>> {
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return (s?.data as Record<string, unknown> | null) ?? {};
}

async function patchData(userId: number, patch: Record<string, unknown>) {
  const data = await readData(userId);
  await db
    .insert(userSettings)
    .values({ userId, data: { ...data, ...patch } })
    .onConflictDoUpdate({ target: userSettings.userId, set: { data: { ...data, ...patch } } });
}

const flowKey = (flow: DeviceFlow) => `${flow}Device`;

export async function rememberDevice(flow: DeviceFlow, userId: number, deviceCode: string, expiresIn: number) {
  await patchData(userId, { [flowKey(flow)]: { deviceCode, expiresAt: Date.now() + expiresIn * 1000 } });
}

export async function hasDevice(flow: DeviceFlow, userId: number, deviceCode: string): Promise<boolean> {
  const row = (await readData(userId))[flowKey(flow)] as DeviceRow | undefined;
  if (!row || typeof row.deviceCode !== "string" || typeof row.expiresAt !== "number") return false;
  if (row.expiresAt < Date.now()) {
    await forgetDevice(flow, userId);
    return false;
  }
  return row.deviceCode === deviceCode;
}

export async function forgetDevice(flow: DeviceFlow, userId: number) {
  await patchData(userId, { [flowKey(flow)]: null });
}
