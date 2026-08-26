/** Rules for turning a local folder into a Hivemind mission. */

export type ImportFile = { path: string; content: string };

const SKIP_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.turbo|vendor|__pycache__|\.venv|venv|target|\.cache|\.output|out|\.impeccable)(\/|$)/i;
const SKIP_FILE = /^(?:\.ds_store|thumbs\.db|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;
const BINARY_EXT =
  /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|woff2?|ttf|otf|eot|mp3|mp4|mov|wav|zip|gz|tgz|bz2|7z|rar|wasm|pdf|exe|dll|so|dylib|bin|class|[oa])$/i;

export const IMPORT_LIMITS = { maxFiles: 80, maxBytesEach: 120_000, maxBytesTotal: 900_000 };

export function normalizeImportPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function shouldSkipImportPath(rel: string): boolean {
  const path = normalizeImportPath(rel);
  if (!path || path.endsWith("/")) return true;
  if (SKIP_DIR.test(path)) return true;
  const base = path.split("/").pop() ?? "";
  return SKIP_FILE.test(base) || BINARY_EXT.test(base);
}

export function looksBinary(content: string): boolean {
  const sample = content.slice(0, 800);
  if (sample.includes("\0")) return true;
  let weird = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) weird++;
  }
  return sample.length > 0 && weird / sample.length > 0.08;
}

export function folderNameFromPaths(paths: string[]): string {
  const top = normalizeImportPath(paths[0] ?? "").split("/")[0] ?? "";
  return top.replace(/[-_]+/g, " ").trim() || "Imported mission";
}

export function inferSpecFromFiles(files: ImportFile[], folderName: string): string {
  const base = (name: string) => files.find((f) => (normalizeImportPath(f.path).split("/").pop() ?? "").toLowerCase() === name);
  const readme = base("readme.md") ?? base("readme");
  const product = base("product.md");
  let pkgDesc = "";
  const pkg = base("package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg.content) as { name?: string; description?: string };
      pkgDesc = [j.description, j.name].filter(Boolean).join(" — ");
    } catch {
      /* ignore */
    }
  }
  const doc = (product?.content || readme?.content || pkgDesc).trim();
  const tree = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 40)
    .map((f) => `- \`${normalizeImportPath(f.path).replace(/^[^/]+\//, "")}\``)
    .join("\n");
  const name = folderName || "Imported project";
  const head = doc
    ? `${name} — existing project imported into Hivemind.\n\n${doc.slice(0, 6000)}`
    : `${name} — existing project imported into Hivemind.\n\nThe operator dropped this folder in so the swarm can spec, critique, and extend what is already here.`;
  return `${head}\n\n## Tree (imported)\n${tree}\n\nContinue from this codebase. Do not scaffold a blank app.`;
}

export function sanitizeImportFiles(input: ImportFile[]): { files: ImportFile[]; skipped: number } {
  const out: ImportFile[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let total = 0;
  for (const raw of input) {
    const path = normalizeImportPath(raw.path);
    const content = String(raw.content ?? "");
    if (!path || seen.has(path) || shouldSkipImportPath(path) || !content || looksBinary(content) || content.length > IMPORT_LIMITS.maxBytesEach) {
      skipped++;
      continue;
    }
    if (out.length >= IMPORT_LIMITS.maxFiles || total + content.length > IMPORT_LIMITS.maxBytesTotal) {
      skipped++;
      continue;
    }
    seen.add(path);
    out.push({ path, content });
    total += content.length;
  }
  return { files: out, skipped };
}
