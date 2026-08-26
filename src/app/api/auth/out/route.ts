import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const c = clearSessionCookie();
  res.cookies.set(c.name, c.value, { maxAge: c.maxAge, path: "/" });
  return res;
}
