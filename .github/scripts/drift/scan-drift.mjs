#!/usr/bin/env node
// Scans the codebase for dependency and pattern drift and updates the pattern registry.
// Config: .github/scripts/drift/drift.config.json. State: .github/memorybank/patterns/drift-state.json
// Usage: node scan-drift.mjs [--json] [--dry-run]
//   --json     print a machine-readable report (used by @drift)
//   --dry-run  report only; don't write the registry or the state file

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import {
  loadConfig, walkFiles, collectLibraries, majorOf, toRepoPath, inPaths, git, blameDates, utcDate,
  readTable, writeTable, PATTERN_COLUMNS, LIBRARY_COLUMNS, registryPath, statePath,
} from './drift-lib.mjs';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const dryRun = args.has('--dry-run');
const today = utcDate();
const MAX_FILE_BYTES = 1024 * 1024;

if (!existsSync(registryPath)) {
  console.error(`Registry not found: ${toRepoPath(registryPath)}`);
  process.exit(1);
}

const config = loadConfig();
const files = walkFiles(config.roots, config.excludeDirs);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
const baseline = state === null;
const head = git(['rev-parse', 'HEAD'])?.trim() ?? null;
const since = state?.lastScan ?? null;

// --- Libraries ---
const libs = collectLibraries(files);
const prevLibs = state?.libraries ?? {};
const libInfo = (key, lib) => ({ key, ecosystem: lib.ecosystem, name: lib.name, version: lib.version, manifest: lib.manifest });
const added = baseline ? [] : [...libs].filter(([key]) => !(key in prevLibs)).map(([key, lib]) => libInfo(key, lib));
const removed = Object.entries(prevLibs)
  .filter(([key]) => !libs.has(key))
  .map(([key, lib]) => ({ key, version: lib.version, manifest: lib.manifest }));
const majorBumped = [...libs]
  .filter(([key, lib]) => {
    const before = prevLibs[key] && majorOf(prevLibs[key].version);
    const after = majorOf(lib.version);
    return before && after && before !== after;
  })
  .map(([key, lib]) => ({ key, from: prevLibs[key].version, to: lib.version, manifest: lib.manifest }));

// --- Patterns ---
const textCache = new Map();
const blameCache = new Map();
const linesOf = (file) => {
  if (!textCache.has(file)) {
    textCache.set(file, statSync(file).size > MAX_FILE_BYTES ? [] : readFileSync(file, 'utf8').split(/\r?\n/));
  }
  return textCache.get(file);
};
const datesOf = (file) => {
  if (!blameCache.has(file)) blameCache.set(file, blameDates(file));
  return blameCache.get(file);
};

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--)/;

// Zero-based line numbers where each match of a global regex starts.
function matchStartLines(text, re) {
  const lines = [];
  let line = 0;
  let cursor = 0;
  for (const m of text.matchAll(re)) {
    let nl;
    while ((nl = text.indexOf('\n', cursor)) !== -1 && nl < m.index) {
      line++;
      cursor = nl + 1;
    }
    lines.push(line);
  }
  return lines;
}

const patternResults = config.patterns.map((p) => {
  const flags = (p.flags ?? '').replace(/[^imsu]/g, '');
  const re = new RegExp(p.regex, p.multiline ? `${flags}g` : flags);
  const fileRe = p.fileRegex ? new RegExp(p.fileRegex, `${flags.replace('m', '')}m`) : null;
  const extensions = p.extensions ?? null;
  const result = { name: p.name, scope: p.scope ?? 'any', files: 0, occurrences: 0, oldest: null, newest: null, skills: p.skills ?? [], matchedFiles: [] };
  for (const file of files) {
    if (extensions && !extensions.some((ext) => file.endsWith(ext))) continue;
    if (!inPaths(p.paths, toRepoPath(file))) continue;
    const lines = linesOf(file);
    if (fileRe && !fileRe.test(lines.join('\n'))) continue;
    const scanned = p.ignoreComments ? lines.map((line) => (COMMENT_LINE.test(line) ? '' : line)) : lines;
    const hits = p.multiline
      ? matchStartLines(scanned.join('\n'), re)
      : scanned.flatMap((line, i) => (re.test(line) ? [i] : []));
    if (hits.length === 0) continue;
    result.files++;
    result.occurrences += hits.length;
    result.matchedFiles.push(toRepoPath(file));
    const dates = datesOf(file);
    for (const i of hits) {
      const d = dates?.[i];
      if (!d) continue;
      if (!result.oldest || d < result.oldest) result.oldest = d;
      if (!result.newest || d > result.newest) result.newest = d;
    }
  }
  return result;
});

// --- Registry ---
let content = readFileSync(registryPath, 'utf8');
const autoRemoved = [];

const prevPatternRows = new Map(readTable(content, 'patterns', PATTERN_COLUMNS).map((r) => [r.Pattern, r]));
const patternRows = patternResults.map((r) => {
  const prev = prevPatternRows.get(r.name);
  let status = prev?.Status || 'Candidate';
  if (status === 'Deprecated' && r.files === 0) {
    status = 'Removed';
    autoRemoved.push(r.name);
  }
  r.status = status;
  r.previousFiles = prev && prev.Files !== '' && !Number.isNaN(Number(prev.Files)) ? Number(prev.Files) : null;
  return {
    Pattern: r.name,
    Scope: r.scope,
    Status: status,
    Files: r.files,
    Occurrences: r.occurrences,
    'Oldest use': r.oldest ?? '—',
    'Newest use': r.newest ?? '—',
    Skills: r.skills.length ? r.skills.map((s) => `\`${s}\``).join(', ') : prev?.Skills || '—',
    Notes: prev?.Notes ?? '',
  };
});
const configured = new Set(patternResults.map((r) => r.name));
for (const [name, row] of prevPatternRows) if (!configured.has(name)) patternRows.push(row);

const prevLibRows = new Map(readTable(content, 'libraries', LIBRARY_COLUMNS).map((r) => [`${r.Ecosystem}:${r.Library}`, r]));
const libraryRows = [...libs]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, lib]) => {
    const prev = prevLibRows.get(key);
    let status = prev?.Status || (baseline ? 'Active' : 'Candidate');
    if (status === 'Removed') status = 'Candidate';
    return { Library: lib.name, Ecosystem: lib.ecosystem, Version: lib.version, Status: status, 'First seen': prev?.['First seen'] || today, Notes: prev?.Notes ?? '' };
  });
for (const [key, row] of prevLibRows) {
  if (libs.has(key)) continue;
  if (row.Status === 'Deprecated') autoRemoved.push(key);
  libraryRows.push({ ...row, Status: row.Status === 'Ignored' ? 'Ignored' : 'Removed' });
}

content = writeTable(content, 'patterns', PATTERN_COLUMNS, patternRows);
content = writeTable(content, 'libraries', LIBRARY_COLUMNS, libraryRows);
content = content.replace(/^Last scan:.*$/m, `Last scan: ${today}${head ? ` (\`${head.slice(0, 7)}\`)` : ''}`);

if (!dryRun) {
  writeFileSync(registryPath, content);
  const libraries = Object.fromEntries([...libs].map(([key, lib]) => [key, { version: lib.version, manifest: lib.manifest }]));
  writeFileSync(statePath, `${JSON.stringify({ lastScan: { date: today, commit: head }, libraries }, null, 2)}\n`);
}

// --- Report ---
const changedFiles = since?.commit && head
  ? git(['diff', '--name-only', `${since.commit}..${head}`, '--', ...config.roots])?.split('\n').filter(Boolean) ?? null
  : null;
const libStatus = (key) => libraryRows.find((r) => `${r.Ecosystem}:${r.Library}` === key)?.Status;
const candidates = [
  ...patternRows.filter((r) => r.Status === 'Candidate').map((r) => ({ kind: 'pattern', name: r.Pattern })),
  ...libraryRows.filter((r) => r.Status === 'Candidate').map((r) => ({ kind: 'library', name: `${r.Ecosystem}:${r.Library}` })),
];
const deprecatedInUse = [
  ...patternResults.filter((r) => r.status === 'Deprecated').map((r) => ({ kind: 'pattern', name: r.name, files: r.files, previousFiles: r.previousFiles, newest: r.newest, matchedFiles: r.matchedFiles })),
  ...[...libs].filter(([key]) => libStatus(key) === 'Deprecated').map(([key, lib]) => ({ kind: 'library', name: key, manifest: lib.manifest })),
];

const report = {
  baseline,
  dryRun,
  since,
  head,
  changedFiles,
  libraries: { total: libs.size, added, removed, majorBumped },
  patterns: patternResults.map(({ matchedFiles, ...r }) => ({ ...r, matchedFiles: matchedFiles.slice(0, 200) })),
  candidates,
  deprecatedInUse,
  autoRemoved,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Scanned ${files.length} files under ${config.roots.join(', ')}${dryRun ? ' (dry run)' : ''}.`);
  console.log(baseline ? `Baseline: recorded ${libs.size} libraries as Active.` : `Since ${since?.date ?? 'last scan'}: ${changedFiles?.length ?? '?'} files changed.`);
  for (const l of added) console.log(`  + library ${l.key} ${l.version} (${l.manifest})`);
  for (const l of removed) console.log(`  - library ${l.key}`);
  for (const l of majorBumped) console.log(`  ^ library ${l.key} ${l.from} -> ${l.to}`);
  for (const p of patternResults) console.log(`  ${p.name.padEnd(40)} ${String(p.files).padStart(4)} files  ${p.status}`);
  for (const d of deprecatedInUse) console.log(`  ! deprecated ${d.kind} still in use: ${d.name}`);
  for (const r of autoRemoved) console.log(`  ✓ deprecated ${r} no longer in use; marked Removed`);
}
