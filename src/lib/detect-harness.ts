import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HARNESSES, type HarnessDef } from "@/lib/harnesses";

const execFileP = promisify(execFile);
const BIN_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export type HarnessStatus = HarnessDef & {
  installed: boolean;
  binPath: string | null;
};

async function whichOne(bin: string): Promise<string | null> {
  if (!BIN_RE.test(bin)) return null;
  try {
    const { stdout } = await execFileP("which", [bin], { timeout: 800 });
    const line = stdout.trim().split("\n")[0]?.trim();
    return line || null;
  } catch {
    return null;
  }
}

export async function detectHarness(h: HarnessDef): Promise<Pick<HarnessStatus, "installed" | "binPath">> {
  if (!h.bin) return { installed: true, binPath: null };
  const names = [...new Set([h.bin, ...h.detect])];
  for (const name of names) {
    const found = await whichOne(name);
    if (found) return { installed: true, binPath: found };
  }
  return { installed: false, binPath: null };
}

export async function detectHarnesses(): Promise<HarnessStatus[]> {
  return Promise.all(
    HARNESSES.map(async (h) => {
      const d = await detectHarness(h);
      return { ...h, ...d };
    })
  );
}

/** Presets plus the user's custom bridges, all probed. */
export async function detectAll(customs: HarnessDef[] = []): Promise<HarnessStatus[]> {
  return Promise.all(
    [...HARNESSES, ...customs].map(async (h) => {
      const d = await detectHarness(h);
      return { ...h, ...d };
    })
  );
}
