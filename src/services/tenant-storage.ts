import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const STORAGE_ROOT = resolve(
  process.env.NOVALOGIC_MCP_STORAGE ||
    join(__dirname, '..', '..', 'storage'),
);

const SLUG_RE = /^[a-z0-9-]+$/;
const NAME_RE = /^[a-z0-9-_]+$/;

export function assertSlug(slug: string, label = 'tenant'): void {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid ${label} slug: "${slug}" (allowed: a-z 0-9 -)`);
  }
}

export function assertName(name: string, label = 'name'): void {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(`Invalid ${label}: "${name}" (allowed: a-z 0-9 - _)`);
  }
}

export function tenantPath(slug: string, ...segments: string[]): string {
  assertSlug(slug);
  const full = resolve(STORAGE_ROOT, slug, ...segments);
  if (!full.startsWith(resolve(STORAGE_ROOT, slug))) {
    throw new Error('Path traversal detected');
  }
  return full;
}

export function ensureTenantDirs(slug: string): void {
  for (const sub of [
    'flows',
    'mappings',
    'datasets',
    'rules',
    'reports',
    'integrations',
    'scripts',
  ]) {
    const p = tenantPath(slug, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

export function listTenants(): string[] {
  if (!existsSync(STORAGE_ROOT)) return [];
  return readdirSync(STORAGE_ROOT)
    .filter((e) => {
      try {
        return (
          statSync(join(STORAGE_ROOT, e)).isDirectory() && SLUG_RE.test(e)
        );
      } catch {
        return false;
      }
    })
    .sort();
}

export function listFiles(dir: string, exts?: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => {
      if (!statSync(join(dir, f)).isFile()) return false;
      if (!exts) return true;
      return exts.some((ext) => f.toLowerCase().endsWith(ext));
    })
    .sort();
}

export function listFilesRecursive(
  dir: string,
  exts?: string[],
  _rel = '',
): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = _rel ? `${_rel}/${entry}` : entry;
    try {
      if (statSync(full).isDirectory()) {
        results.push(...listFilesRecursive(full, exts, rel));
      } else if (!exts || exts.some((ext) => entry.toLowerCase().endsWith(ext))) {
        results.push(rel);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
