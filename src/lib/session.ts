import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE = "hive_session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return s;
}

function sign(payload: string): string {
  return Buffer.from(payload).toString("base64url") +
    "." +
    createHmac("sha256", secret()).update(payload).digest("base64url");
}

function verify(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const raw = Buffer.from(payload, "base64url").toString();
  const expect = createHmac("sha256", secret()).update(raw).digest("base64url");
  try {
    if (
      timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
    ) {
      return raw;
    }
  } catch {
    return null;
  }
  return null;
}

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  hue: number;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE)?.value;
    if (!token) return null;
    const raw = verify(token);
    if (!raw) return null;
    const { uid } = JSON.parse(raw) as { uid: number };
    const [row] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name, hue: row.hue };
  } catch {
    return null;
  }
}

export function sessionCookieValue(uid: number): { name: string; value: string; maxAge: number } {
  return {
    name: COOKIE,
    value: sign(JSON.stringify({ uid })),
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function clearSessionCookie(): { name: string; value: string; maxAge: number } {
  return { name: COOKIE, value: "", maxAge: 0 };
}
