#!/usr/bin/env node
// test.mjs - the one deterministic way agents run tests. Same flags, same output, every time.
//   node test.mjs <suite> --scope created|related|impacted|all [--repeat <2-5>] [--coverage] [--filter <expr>] [--base <ref>] [--json]
// Suites live in scripts/test/suites/<suite>.json (user-owned); each names a runner adapter in
// scripts/test/runners/<runner>.mjs (provided by the stack module). Agents read the short summary,
// never the raw log or the coverage XML.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, UsageError } from '../adlc-lib/args.mjs';
import { runFixedCommand, runCapture } from '../adlc-lib/exec.mjs';
import { getChangedFiles, changedLinesFor, matchesAny, normalizePath } from '../adlc-lib/changed-files.mjs';
import { diffCoverage, renderCoverage } from '../adlc-lib/coverage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, USAGE: 2, MISSING: 3, NOTHING_SELECTED: 4, TIMEOUT: 5 });
const SCOPES = ['created', 'related', 'impacted', 'all'];
const REPEAT_RE = /^[2-5]$/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const MAX_FAILURES = 10;
const FAILURE_LINES = 5;

const HELP = `test.mjs - run tests the same way every time

Usage:
  node test.mjs <suite> --scope created|related|impacted|all [--repeat <2-5>] [--coverage] [--filter <expr>] [--base <ref>] [--json]

  --scope created   only tests added or modified by the current work (what an implementer runs)
  --scope related   created plus tests impacted by the changed source
  --scope impacted  tests impacted by the changed source, without the ones the change added or modified (what a reviewer runs)
  --scope all       the whole suite (never auto-approved; asks a human)
  --repeat <n>      run each selected test n times (2 to 5) to expose flaky tests; only runners that support it
  --coverage        report coverage of the changed lines (never a gate)
  --filter <expr>   narrow further, e.g. to one failing test
  --base <ref>      branch the work started from (default: main)

Exit codes: 0 pass, 1 failures (including flaky tests), 2 usage/config (including --repeat on a runner without it), 3 runner or tool missing, 4 no tests selected, 5 timeout`;

async function defaultLoadSuite(name) {
  const file = path.join(__dirname, 'suites', `${name}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      let available = [];
      try { available = (await readdir(path.join(__dirname, 'suites'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* none installed */ }
      throw new UsageError(`unknown suite "${name}". Available: ${available.join(', ') || '(none; select a stack module that provides test suites)'}`);
    }
    throw new UsageError(`suite "${name}" is not valid JSON: ${err.message}`);
  }
}

async function defaultLoadRunner(name) {
  if (!NAME_RE.test(name ?? '')) throw new UsageError(`suite has an invalid "runner": ${name}`);
  const file = path.join(__dirname, 'runners', `${name}.mjs`);
  if (!existsSync(file)) return null;
  return import(pathToFileURL(file).href);
}

async function findNewestFirst(dir, fileName) {
  const found = [];
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === fileName) found.push({ p, t: (await stat(p)).mtimeMs });
    }
  };
  await walk(dir);
  return found.sort((a, b) => b.t - a.t).map((f) => f.p);
}

function firstLines(text, n) {
  return String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter(Boolean).slice(0, n);
}

function render(summary, json) {
  if (json) return JSON.stringify(summary, null, 2);
  const lines = [];
  const filter = summary.filter ? ` filter="${summary.filter.length > 160 ? `${summary.filter.slice(0, 157)}...` : summary.filter}"` : '';
  lines.push(`test ${summary.suite} scope=${summary.scope} selected=${summary.selected}${summary.unit ? ` ${summary.unit}` : ''}${summary.repeat ? ` repeat=${summary.repeat}` : ''}${filter}`);
  lines.push(summary.resultLine);
  for (const f of summary.failures.slice(0, MAX_FAILURES)) {
    lines.push(`  ${f.label ?? 'FAILED'} ${f.name}`);
    for (const l of firstLines(f.message, FAILURE_LINES)) lines.push(`    ${l}`);
  }
  if (summary.failures.length > MAX_FAILURES) lines.push(`  ... and ${summary.failures.length - MAX_FAILURES} more failures (see log)`);
  for (const l of summary.notes ?? []) lines.push(l);
  if (summary.coverageLine) lines.push(summary.coverageLine);
  if (summary.log) lines.push(`LOG ${summary.log}`);
  return lines.join('\n');
}

export async function run(argv, {
  cwd = process.cwd(), exec = runFixedCommand, capture = runCapture,
  loadSuite = defaultLoadSuite, loadRunner = defaultLoadRunner, log = console.log, logErr = console.error,
} = {}) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs(argv, {
      scope: { type: 'string' }, coverage: { type: 'boolean' }, filter: { type: 'string' },
      base: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' }, repeat: { type: 'string' },
    }));
    if (values.help || argv.length === 0) { log(HELP); return EXIT.PASS; }
    const name = positionals[0];
    if (!name || !NAME_RE.test(name)) throw new UsageError('first argument must be a suite name, e.g. unit');
    if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
    if (!SCOPES.includes(values.scope)) throw new UsageError(`--scope is required: ${SCOPES.join(' | ')}`);
    if (values.repeat !== undefined && !REPEAT_RE.test(values.repeat)) throw new UsageError('--repeat must be a number from 2 to 5');
  } catch (err) {
    if (err instanceof UsageError) { logErr(`test.mjs: ${err.message}`); return EXIT.USAGE; }
    throw err;
  }

  const name = positionals[0];
  const scope = values.scope;
  const repeat = values.repeat === undefined ? undefined : Number(values.repeat);
  const reviewScope = scope === 'related' || scope === 'impacted';
  let suite;
  let runner;
  try {
    suite = { ...(await loadSuite(name)), name };
    runner = await loadRunner(suite.runner);
  } catch (err) {
    if (err instanceof UsageError) { logErr(`test.mjs: ${err.message}`); return EXIT.USAGE; }
    throw err;
  }
  if (!runner) { logErr(`test.mjs: runner "${suite.runner}" is not installed for suite "${name}".`); return EXIT.MISSING; }
  if (repeat && !runner.supportsRepeat) { logErr(`test.mjs: --repeat is not supported by the ${runner.id ?? suite.runner} runner`); return EXIT.USAGE; }

  const resultsRel = `.github/memorybank/test-runs/${name}`;
  const resultsDir = path.join(cwd, resultsRel);
  const ctx = {
    cwd, suite, resultsDir,
    matches: matchesAny,
    readFile: (rel) => readFile(path.join(cwd, rel), 'utf8'),
    readAbs: (abs) => readFile(abs, 'utf8'),
    findFiles: findNewestFirst,
    // First existing <dir>/<relPath> from startDir up to the repository root, or null; never looks above the root.
    findUp: (startDir, relPath) => {
      const root = path.resolve(cwd);
      const inside = (d) => { const r = path.relative(root, d); return !r.startsWith('..') && !path.isAbsolute(r); };
      for (let dir = path.resolve(root, startDir); inside(dir); dir = path.dirname(dir)) {
        const candidate = path.join(dir, relPath);
        if (existsSync(candidate)) return candidate;
        if (dir === root) break;
      }
      return null;
    },
    listFiles: async () => {
      const out = [];
      for (const args of [['ls-files'], ['ls-files', '--others', '--exclude-standard']]) {
        const r = await exec('git', args);
        for (const l of (r?.stdout ?? '').split(/\r?\n/)) if (l.trim()) out.push(normalizePath(l.trim()));
      }
      return out;
    },
    toRepoPath: (sources, filename) => {
      for (const s of sources) {
        const abs = path.resolve(s, filename);
        const rel = path.relative(cwd, abs);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && existsSync(abs)) return normalizePath(rel);
      }
      return null;
    },
  };

  let changed;
  let selection;
  let command;
  try {
    changed = await getChangedFiles(exec, { base: values.base ?? 'main' });
    selection = scope === 'all'
      ? { filter: '', selectedCount: 'all', label: '', files: [] }
      : await runner.selectTests(ctx, suite, scope, changed);
    command = runner.buildCommand(ctx, suite, selection, { coverage: Boolean(values.coverage), filter: values.filter, repeat });
  } catch (err) {
    logErr(`test.mjs: ${err.message}`);
    return EXIT.USAGE;
  }

  const base = { suite: name, scope, selected: selection.selectedCount, unit: selection.unit, repeat, filter: command.filterShown ?? '', failures: [], notes: [] };

  if (scope === 'created' && selection.selectedCount === 0) {
    log(render({ ...base, resultLine: `RESULT NONE no tests selected: no added or modified file matches testFileGlobs ${JSON.stringify(suite.testFileGlobs ?? [])}. Write or change a test first.` }, values.json));
    return EXIT.NOTHING_SELECTED;
  }
  if (reviewScope && selection.selectedCount === 0) {
    log(render({ ...base, resultLine: 'RESULT PASS no impacted tests found for the changed code (0 selected)', notes: selection.note ? [`NOTE ${selection.note}`] : [] }, values.json));
    return EXIT.PASS;
  }
  if (command.missing) { logErr(`test.mjs: ${command.missing}`); return EXIT.MISSING; }

  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  const started = Date.now();
  const proc = await capture(command.command, command.args, {
    cwd: command.cwd ?? cwd,
    env: command.env ? { ...process.env, ...command.env } : process.env,
    timeout: (suite.timeoutSeconds ?? 600) * 1000,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (proc === null) { logErr(`test.mjs: could not run "${command.command}" (not installed or not on PATH).`); return EXIT.MISSING; }
  const logRel = `${resultsRel}/run.log`;
  await writeFile(path.join(cwd, logRel), `${proc.stdout}\n${proc.stderr}`);
  if (proc.timedOut) {
    log(render({ ...base, resultLine: `RESULT FAIL timed out after ${suite.timeoutSeconds ?? 600}s`, log: logRel }, values.json));
    return EXIT.TIMEOUT;
  }

  const parsed = await runner.parseResults(ctx);
  if (!parsed) {
    const errors = `${proc.stdout}\n${proc.stderr}`.split(/\r?\n/).filter((l) => /\berror\b/i.test(l)).slice(0, FAILURE_LINES * 2);
    log(render({ ...base, resultLine: `RESULT FAIL no test results were produced (build or test host failed, exit ${proc.code}, ${seconds}s)`, notes: errors.map((l) => `  ${l.trim()}`), log: logRel }, values.json));
    return EXIT.FAIL;
  }
  if (parsed.total === 0 && reviewScope) {
    log(render({ ...base, resultLine: `RESULT PASS no impacted tests found for the changed code (${seconds}s)`, notes: selection.note ? [`NOTE ${selection.note}`] : [], log: logRel }, values.json));
    return EXIT.PASS;
  }
  const nothingRan = parsed.total === 0 || (parsed.passed + parsed.failed === 0 && proc.code === 0);
  if (nothingRan) {
    const why = parsed.skipped > 0 ? `${parsed.skipped} test(s) were skipped by the filter or marked skip` : 'the filter matched nothing';
    log(render({ ...base, resultLine: `RESULT NONE no tests ran (${seconds}s); ${why}`, notes: values.filter && runner.filterHint ? [`HINT ${runner.filterHint}`] : [], log: logRel }, values.json));
    return EXIT.NOTHING_SELECTED;
  }

  const failed = parsed.failed > 0 || proc.code !== 0;
  const summary = {
    ...base,
    resultLine: `RESULT ${failed ? 'FAIL' : 'PASS'} ${parsed.passed} passed, ${parsed.failed} failed, ${parsed.skipped} skipped (${seconds}s)${parsed.failed === 0 && proc.code !== 0 ? ` - runner exited ${proc.code}` : ''}`,
    result: { passed: parsed.passed, failed: parsed.failed, skipped: parsed.skipped, total: parsed.total },
    failures: parsed.failures,
    notes: reviewScope && selection.note ? [`NOTE ${selection.note}`] : [],
    log: logRel,
  };

  if (values.coverage) {
    let cov = { lines: null, reason: `the ${suite.runner} runner provides no coverage` };
    if (runner.parseCoverage) cov = await runner.parseCoverage(ctx);
    if (!cov.lines) summary.coverageLine = renderCoverage(null, { reason: cov.reason });
    else {
      const sources = [...changed.files.keys()].filter((f) => matchesAny(suite.sourceGlobs, f) && !matchesAny(suite.testFileGlobs, f));
      const lines = new Map();
      for (const f of sources) lines.set(f, await changedLinesFor(changed, f, ctx.readFile));
      const result = diffCoverage(cov.lines, lines);
      summary.coverage = result;
      summary.coverageLine = renderCoverage(result);
    }
  }

  log(render(summary, values.json));
  return failed ? EXIT.FAIL : EXIT.PASS;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`test.mjs: ${err.message}`); process.exitCode = EXIT.USAGE; });
}
