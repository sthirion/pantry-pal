// What changed in this working copy, for the test runner: files (committed since the merge-base
// with the target branch + uncommitted + untracked) and the changed line numbers per file.
// Diffing the working tree against the merge-base gives new-side line numbers of what is on disk,
// so committed and uncommitted work are treated the same. Run from the repository root.

// Paths that reach a command line must match this (git paths are not trusted blindly).
export const SAFE_PATH_RE = /^[\w@+()[\] ./\\-]+$/;
export const SAFE_REF_RE = /^[\w./-]+$/;
// Globs passed to `scm.mjs changed-files --include`; same character set the auto-approve rule allows.
export const SAFE_GLOB_RE = /^[\w./*!@{}-]+$/;

export function normalizePath(p) {
  return p.replaceAll('\\', '/');
}

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** A file matches when some positive glob matches it and no `!`-prefixed glob does, so one suite
 * can say "every test file except the Integration folder" instead of listing folders. */
export function matchesAny(globs, file) {
  const f = normalizePath(file);
  const list = globs ?? [];
  if (list.some((g) => g.startsWith('!') && globToRegExp(g.slice(1)).test(f))) return false;
  return list.some((g) => !g.startsWith('!') && globToRegExp(g).test(f));
}

/** Resolves the diff base: prefers origin/<base> (what a PR compares against), falls back to the
 * local branch, then to HEAD (working tree vs HEAD only). */
export async function resolveBase(exec, base = 'main') {
  if (!SAFE_REF_RE.test(base)) throw new Error(`invalid base ref: ${base}`);
  let ref = null;
  for (const candidate of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if (await exec('git', ['rev-parse', '--verify', '--quiet', candidate]) !== null) { ref = candidate.replace(/^refs\/(?:remotes|heads)\//, ''); break; }
  }
  if (!ref) return { ref: null, mergeBase: 'HEAD' };
  const mb = await exec('git', ['merge-base', 'HEAD', ref]);
  const sha = mb?.stdout?.trim();
  return { ref, mergeBase: sha || 'HEAD' };
}

function parseNameStatus(stdout) {
  const files = new Map();
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0][0];
    const file = normalizePath(parts[parts.length - 1]);
    files.set(file, status);
  }
  return files;
}

/** Parses `git diff -U0` output into Map<file, Set<newLineNumber>>. Deleted-only hunks add nothing. */
export function parseChangedLines(diffText) {
  const result = new Map();
  let current = null;
  for (const line of (diffText ?? '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? null : normalizePath(target.replace(/^b\//, ''));
      if (current && !result.has(current)) result.set(current, new Set());
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m && current) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let n = start; n < start + count; n += 1) result.get(current).add(n);
    }
  }
  return result;
}

/** Formats changed line numbers as compact ranges: {12,13,14,15,16,17,18,40} -> "12-18, 40". */
export function formatLineRanges(lineSet) {
  const sorted = [...new Set(lineSet)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    ranges.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return ranges.join(', ');
}

/** @returns {Promise<{ base: string|null, mergeBase: string, files: Map<string,string>, lines: Map<string,Set<number>> }>}
 *  files: path -> status (A, C, M, R, or U for untracked). lines: only computed for tracked files;
 *  untracked files are whole-file changes (see changedLinesFor). */
export async function getChangedFiles(exec, { base = 'main' } = {}) {
  const { ref, mergeBase } = await resolveBase(exec, base);
  const tracked = await exec('git', ['diff', '--name-status', '--diff-filter=ACMR', mergeBase]);
  const files = parseNameStatus(tracked?.stdout);
  const untracked = await exec('git', ['ls-files', '--others', '--exclude-standard']);
  for (const f of (untracked?.stdout ?? '').split(/\r?\n/)) {
    if (f.trim()) files.set(normalizePath(f.trim()), 'U');
  }
  const diff = await exec('git', ['diff', '-U0', '--diff-filter=ACMR', mergeBase]);
  return { base: ref, mergeBase, files, lines: parseChangedLines(diff?.stdout) };
}

/** Changed line numbers for one file; untracked files count every line. */
export async function changedLinesFor(changed, file, readFile) {
  const known = changed.lines.get(file);
  if (known) return known;
  if (changed.files.get(file) === 'U' && readFile) {
    const text = await readFile(file);
    const n = text.split(/\r?\n/).length;
    return new Set(Array.from({ length: n }, (_, i) => i + 1));
  }
  return new Set();
}
