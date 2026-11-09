// vitest runner adapter for scripts/test/test.mjs. Shared by the node-ts, react and astro modules
// (modules/shared/vitest). No imports: it sits next to the dispatcher only after create-adlc assembles the
// target, so everything it needs comes in through `ctx`. Runs vitest's own JS entry with the current
// node (no npx, no cmd.exe shim). Facts verified in the Phase 0 spike: `vitest related`, the json
// reporter, and istanbul statement data over-reporting (so coverage takes the MIN hit per line).

export const id = 'vitest';

export const filterHint = 'The filter is a test-name regex (vitest --testNamePattern), e.g. --filter "renders the title".';

const FILTER_RE = /^[\w.~=|!(), -]+$/;
const CONFIG_RE = /^[\w./-]+$/;
const PROJECT_NAME_RE = /^[\w. -]+$/;
const slash = (p) => String(p).replace(/\\/g, '/');

function projectPrefix(suite) {
  return `${slash(suite.project).replace(/\/+$/, '')}/`;
}

/** Test files added or modified (created), plus, for related, the changed source files:
 * `vitest related` then resolves which tests import them. `impacted` runs `vitest related` on the
 * changed sources only and excludes the changed test files, so a reviewer never re-runs what the author ran. */
export async function selectTests(ctx, suite, scope, changed) {
  const isTest = (f) => ctx.matches(suite.testFileGlobs, f);
  const isSource = (f) => ctx.matches(suite.sourceGlobs, f) && !isTest(f);
  const files = [...changed.files.keys()];
  const tests = files.filter(isTest);
  const sources = files.filter(isSource);
  if (scope === 'created') return { mode: 'run', files: tests, sources, selectedCount: tests.length, unit: 'test files', note: '' };
  if (scope === 'impacted') return { mode: 'related', files: sources, excludes: tests, sources, selectedCount: sources.length, unit: 'changed files', note: 'impacted tests resolved by vitest related, without the changed test files' };
  const inputs = [...tests, ...sources];
  return { mode: 'related', files: inputs, sources, selectedCount: inputs.length, unit: 'changed files', note: 'impacted tests resolved by vitest related' };
}

export function buildCommand(ctx, suite, selection, opts) {
  if (opts.filter && !FILTER_RE.test(opts.filter)) throw new Error('--filter contains characters that are not allowed');
  if (suite.config && (!CONFIG_RE.test(suite.config) || suite.config.includes('..'))) throw new Error('suite "config" contains characters that are not allowed');
  if (suite.vitestProject && !PROJECT_NAME_RE.test(suite.vitestProject)) throw new Error('suite "vitestProject" contains characters that are not allowed');
  const prefix = projectPrefix(suite);
  const bin = suite.bin ?? ctx.findUp(suite.project, 'node_modules/vitest/vitest.mjs');
  if (!bin) return { missing: `vitest is not installed: node_modules/vitest/vitest.mjs was not found in ${slash(suite.project)} or any parent up to the repository root. Run npm install, or set "bin" in the suite.` };
  const rel = (f) => (slash(f).startsWith(prefix) ? slash(f).slice(prefix.length) : `${slash(ctx.cwd)}/${slash(f)}`);
  const files = (selection.files ?? []).map(rel);
  const results = slash(ctx.resultsDir);
  const args = [slash(bin)];
  if (selection.mode === 'related') args.push('related', ...files, '--run', '--passWithNoTests');
  else args.push('run', ...files);
  if (suite.config) args.push(`--config=${suite.config}`);
  if (suite.vitestProject) args.push(`--project=${suite.vitestProject}`);
  for (const f of selection.excludes ?? []) args.push(`--exclude=${rel(f)}`);
  args.push('--reporter=json', `--outputFile=${results}/results.json`);
  if (opts.coverage) {
    args.push('--coverage.enabled=true', '--coverage.reportOnFailure=true', '--coverage.reporter=json', `--coverage.reportsDirectory=${results}/coverage`);
    // Listing the changed sources makes vitest report the ones no test loads as 0% instead of omitting them.
    for (const s of selection.sources ?? []) args.push(`--coverage.include=${rel(s)}`);
  }
  if (opts.filter) args.push(`--testNamePattern=${opts.filter}`);
  const shown = [...files, opts.filter ? `-t ${opts.filter}` : ''].filter(Boolean).join(' ');
  return { command: process.execPath, args, cwd: `${slash(ctx.cwd)}/${prefix}`.replace(/\/+$/, ''), filterShown: shown };
}

/** vitest json report -> counts + failures. A test file that failed to load (import or syntax error)
 * has no assertions; it counts as one failure carrying the file's message. Stack frames inside
 * node_modules are dropped so the first lines of a message are the assertion and the test frame. */
export function parseVitestJson(json, cwd) {
  const root = `${slash(cwd).replace(/\/+$/, '')}/`;
  const rel = (p) => (slash(p).startsWith(root) ? slash(p).slice(root.length) : slash(p));
  const clean = (text) => String(text ?? '').split(/\r?\n/).filter((l) => !/^\s+at .*(node_modules|node:internal|<anonymous>)/.test(l)).join('\n');
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];
  for (const file of json?.testResults ?? []) {
    const items = file.assertionResults ?? [];
    for (const t of items) {
      if (t.status === 'passed') passed += 1;
      else if (t.status === 'failed') {
        failed += 1;
        failures.push({ name: `${rel(file.name)} > ${t.fullName ?? t.title}`, message: clean((t.failureMessages ?? []).join('\n')) });
      } else skipped += 1;
    }
    if (file.status === 'failed' && !items.some((t) => t.status === 'failed')) {
      failed += 1;
      failures.push({ name: rel(file.name), message: clean(file.message) });
    }
  }
  return { passed, failed, skipped, total: passed + failed + skipped, failures };
}

export async function parseResults(ctx) {
  const found = await ctx.findFiles(ctx.resultsDir, 'results.json');
  if (!found.length) return null;
  try {
    return parseVitestJson(JSON.parse(await ctx.readAbs(found[0])), ctx.cwd);
  } catch {
    return null;
  }
}

/** istanbul coverage-final.json -> Map<repoRelPath, Map<line, hits>>. A line can start several
 * statements (a declaration and its arrow-function body); the MIN hit wins so a never-called
 * function is not reported as covered. Files outside the repo (node_modules aliases) are dropped. */
export function parseIstanbul(json, toRepoPath) {
  const files = new Map();
  for (const [abs, data] of Object.entries(json ?? {})) {
    const key = toRepoPath(abs);
    if (!key) continue;
    const lines = new Map();
    for (const [stmtId, loc] of Object.entries(data.statementMap ?? {})) {
      const n = loc?.start?.line;
      if (!Number.isInteger(n)) continue;
      const hits = data.s?.[stmtId] ?? 0;
      lines.set(n, lines.has(n) ? Math.min(lines.get(n), hits) : hits);
    }
    files.set(key, lines);
  }
  return files;
}

export async function parseCoverage(ctx) {
  const found = await ctx.findFiles(ctx.resultsDir, 'coverage-final.json');
  if (!found.length) return { lines: null, reason: 'no coverage report produced; is @vitest/coverage-v8 installed in the frontend project?' };
  try {
    return { lines: parseIstanbul(JSON.parse(await ctx.readAbs(found[0])), (abs) => ctx.toRepoPath([ctx.cwd], abs)), reason: null };
  } catch {
    return { lines: null, reason: 'the coverage report could not be parsed' };
  }
}
