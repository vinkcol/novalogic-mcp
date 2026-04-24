import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const IGNORED_DIRS = ['node_modules', 'dist', '.git', '.next', 'coverage'];

export function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

export function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

export function findFiles(
  dir: string,
  pattern: RegExp,
  results: string[] = [],
): string[] {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory() && !IGNORED_DIRS.includes(entry)) {
          findFiles(full, pattern, results);
        } else if (pattern.test(entry)) {
          results.push(full);
        }
      } catch {}
    }
  } catch {}
  return results;
}

export function getDirectoryTree(
  dirPath: string,
  depth: number = 2,
  prefix: string = '',
): string {
  if (depth < 0) return '';
  const entries = listDir(dirPath).filter((e) => !IGNORED_DIRS.includes(e));
  let result = '';

  entries.forEach((entry, i) => {
    const fullPath = join(dirPath, entry);
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    try {
      const stat = statSync(fullPath);
      result +=
        prefix +
        connector +
        entry +
        (stat.isDirectory() ? '/' : '') +
        '\n';
      if (stat.isDirectory() && depth > 0) {
        result += getDirectoryTree(
          fullPath,
          depth - 1,
          prefix + childPrefix,
        );
      }
    } catch {}
  });
  return result;
}

export { existsSync, join };
