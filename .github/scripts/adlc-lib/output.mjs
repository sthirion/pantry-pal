// Output rendering, --out handling, and exit codes (design doc §4.4, §6). Shared by every
// tracker/scm command.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH_REQUIRED: 3,
  NOT_FOUND: 4,
  UNSUPPORTED: 5,
});

/** Resolves `target` relative to `baseDir` and rejects any path that would land outside it
 * (`..` escapes, absolute paths elsewhere) — required for every --out/--input/--body-file
 * argument (§11 security). */
export function resolveSafePath(baseDir, target) {
  const resolved = path.resolve(baseDir, target);
  const rel = path.relative(baseDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the repository: ${target}`);
  }
  return resolved;
}

/** Writes `content` to `--out <file>` (printing a one-line summary) or to stdout when no
 * `out` is given (design doc §5: "compact markdown on stdout by default ... --out <file>
 * writes to a file and prints only a one-line summary"). */
export async function emit(content, { out, cwd = process.cwd(), log = console.log } = {}) {
  if (out) {
    const dest = resolveSafePath(cwd, out);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, 'utf8');
    log(`Wrote ${path.relative(cwd, dest).split(path.sep).join('/')}`);
    return;
  }
  log(content);
}

/** Truncates `text` to `max` characters, appending `(truncated)` when it was cut (§5.3:
 * comments capped at 2000 chars, related-item excerpts at 500). */
export function truncate(text, max) {
  if (!text || text.length <= max) return text ?? '';
  return `${text.slice(0, max)} (truncated)`;
}

/** Renders a GitHub-flavored markdown table from a header row and an array of row arrays. */
export function renderTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map((row) => line(row))].join('\n');
}

/** UTC timestamp in the exact form the plan mandates for tool-written dates, e.g.
 * `2026-09-28T14:03Z`. */
export function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
}
