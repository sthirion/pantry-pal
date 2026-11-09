#!/usr/bin/env node
// Tracker dispatcher (design doc §4.2): parse args -> load config -> resolve auth -> load
// ./tracker-adapter.mjs -> call the adapter method -> render output -> exit code.
//
// Phase 3 added the write commands (create/update/comment/link); Phase 4 adds `testcase
// create` (ADO test cases + suite add + Tested By link, with a suite choice and a preview/hash
// approval step), capability-gated like `iteration`.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, UsageError, requirePositiveIntId } from '../adlc-lib/args.mjs';
import { EXIT, emit, renderTable, resolveSafePath, utcTimestamp } from '../adlc-lib/output.mjs';
import {
  loadTrackerConfig, ConfigError, detectGitRemoteUrl, parseGitHubRemote, apiBaseForHost,
} from '../adlc-lib/config.mjs';
import { AuthRequiredError, resolveGitHubAuth, resolveAdoAuth } from '../adlc-lib/auth.mjs';
import { authHeader, request, requestJson, redactHeaders, HttpError } from '../adlc-lib/http.mjs';
import { runFixedCommand } from '../adlc-lib/exec.mjs';
import { htmlToMarkdown } from '../adlc-lib/html-to-md.mjs';
import { markdownToHtml } from '../adlc-lib/md-to-html.mjs';
import { renderContextMd, storyChangedSinceLastFetch } from '../adlc-lib/context-md.mjs';
import {
  ValidationError, computeHash, computeTestCaseHash, parseOnlyRows, readBatchInput, renderPreviewTable,
  renderTestCasePreview, resolveRowLinks, validateEntries, withoutRowLinks, writeBatchInput,
} from '../adlc-lib/batch-create.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const READ_COMMANDS = ['auth-check', 'fetch', 'search', 'iteration'];
const WRITE_COMMANDS = ['create', 'update', 'comment', 'link', 'testcase'];

/** Resolves the credentials for the configured tracker. Exported as the default of run()'s
 * `resolveAuth` so a caller (a test, mostly) can replace the whole lookup. */
export function defaultResolveAuth(config, target) {
  return config.tracker === 'ado'
    ? resolveAdoAuth({ org: config.org?.replace(/^https?:\/\/dev\.azure\.com\//, '') })
    : resolveGitHubAuth({ host: target.host });
}

/** `exec`, `http`, `resolveAuth`, `configDir` and `adapter` are injectable so the whole
 * dispatcher runs without a network, a subprocess or a signed-in user. `adapter` is an
 * already-imported adapter module; it defaults to the `tracker-adapter.mjs` next to this file,
 * which only exists in a generated project. */
export async function run(argv, {
  cwd = process.cwd(),
  exec = runFixedCommand,
  http = { request, requestJson },
  resolveAuth = defaultResolveAuth,
  configDir = __dirname,
  adapter: injectedAdapter,
} = {}) {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return EXIT.OK;
  }

  if (!READ_COMMANDS.includes(command) && !WRITE_COMMANDS.includes(command)) {
    console.error(`Unknown command "${command}". Available: ${[...READ_COMMANDS, ...WRITE_COMMANDS].join(', ')}.`);
    return EXIT.USAGE;
  }

  let adapter = injectedAdapter;
  if (!adapter) {
    try {
      adapter = await import(pathToFileURL(path.join(__dirname, 'tracker-adapter.mjs')).href);
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('No tracker module selected in create-adlc; tracker commands are unavailable.');
        return EXIT.USAGE;
      }
      throw err;
    }
  }

  let config;
  try {
    config = await loadTrackerConfig(configDir);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return EXIT.USAGE;
    }
    throw err;
  }

  if (command === 'iteration' && !adapter.capabilities?.iterations) {
    console.error(`Unsupported by this tracker (${config.tracker}): no iteration/sprint concept.`);
    return EXIT.UNSUPPORTED;
  }
  if (command === 'testcase' && !adapter.capabilities?.testCases) {
    console.error(`Unsupported by this tracker (${config.tracker}): no test case concept.`);
    return EXIT.UNSUPPORTED;
  }

  const target = await resolveTarget(config, exec);
  if (!target) {
    console.error(
      config.tracker === 'github'
        ? 'Could not determine the GitHub owner/repo — no "origin" git remote and no override in tracker.config.json.'
        : 'tracker.config.json: "org" and "project" are required for Azure DevOps.'
    );
    return EXIT.USAGE;
  }

  // A `testcase create --dry-run` only validates the input and prints a preview: it sends nothing,
  // so it needs no credentials and must work before the user has signed in.
  const needsAuth = !(command === 'testcase' && rest.includes('--dry-run'));
  let auth = null;
  if (needsAuth) {
    try {
      auth = await resolveAuth(config, target);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        console.error(err.message);
        return EXIT.AUTH_REQUIRED;
      }
      throw err;
    }
  }

  const ctx = {
    config,
    target,
    auth,
    http,
    lib: { authHeader, htmlToMarkdown, markdownToHtml },
  };

  try {
    return await dispatch(command, rest, { adapter, ctx, cwd });
  } catch (err) {
    if (err instanceof UsageError || err instanceof ValidationError) {
      console.error(err.message);
      return EXIT.USAGE;
    }
    if (err instanceof HttpError) {
      console.error(err.message);
      return err.status === 404 ? EXIT.NOT_FOUND : EXIT.ERROR;
    }
    throw err;
  }
}

async function resolveTarget(config, exec) {
  if (config.tracker === 'ado') {
    if (!config.org || !config.project) return null;
    return { org: config.org, project: config.project, team: config.team };
  }
  const remoteUrl = await detectGitRemoteUrl(exec);
  const parsed = parseGitHubRemote(remoteUrl) ?? {};
  const host = config.host ?? parsed.host ?? 'github.com';
  const owner = config.owner ?? parsed.owner;
  const repo = config.repo ?? parsed.repo;
  if (!owner || !repo) return null;
  return { host, owner, repo, apiBase: apiBaseForHost(host).rest };
}

async function dispatch(command, args, { adapter, ctx, cwd }) {
  if (command === 'auth-check') return runAuthCheck(adapter, ctx, args, cwd);
  if (command === 'fetch') return runFetch(adapter, ctx, args, cwd);
  if (command === 'search') return runSearch(adapter, ctx, args, cwd);
  if (command === 'iteration') return runIteration(adapter, ctx, args, cwd);
  if (command === 'create') return runCreate(adapter, ctx, args, cwd);
  if (command === 'update') return runUpdate(adapter, ctx, args, cwd);
  if (command === 'comment') return runComment(adapter, ctx, args, cwd);
  if (command === 'link') return runLink(adapter, ctx, args, cwd);
  if (command === 'testcase') return runTestcase(adapter, ctx, args, cwd);
  throw new UsageError(`Unhandled command "${command}"`);
}

async function runAuthCheck(adapter, ctx, args, cwd) {
  const { values } = parseArgs(args, { out: { type: 'string' }, json: { type: 'boolean', default: false } });
  const result = await adapter.authCheck(ctx);
  const content = values.json
    ? JSON.stringify(result)
    : `Signed in to ${ctx.config.tracker} as ${result.identity}`;
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

async function runFetch(adapter, ctx, args, cwd) {
  const [idArg, ...flagArgs] = args;
  const id = requirePositiveIntId(idArg, 'fetch <id>');
  const { values } = parseArgs(flagArgs, {
    depth: { type: 'string', default: '1' },
    comments: { type: 'string', default: '20' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
  });

  const workItem = await adapter.getWorkItem(ctx, id);
  const comments = await adapter.getComments(ctx, id, { top: Number(values.comments) });
  const relatedSummaries = workItem.relations.length ? await adapter.getRelated(ctx, workItem.relations) : [];
  // Carry the relation's own `comment` (e.g. "cloned from") through to the resolved summary —
  // getRelated returns WorkItemSummary shapes, which don't have it, but the context.md Note
  // column heuristic (§5.3) needs it.
  const related = relatedSummaries.map((summary) => {
    const relation = workItem.relations.find((r) => r.kind === summary.kind && r.id === summary.id);
    return { ...summary, comment: relation?.comment ?? '' };
  });

  let previousContent = null;
  if (values.out) {
    const dest = path.resolve(cwd, values.out);
    if (existsSync(dest)) previousContent = await readFile(dest, 'utf8');
  }

  if (values.json) {
    await emit(JSON.stringify({ workItem, comments, related }), { out: values.out, cwd });
    return EXIT.OK;
  }

  const generatedAt = utcTimestamp();
  const content = renderContextMd({ id, workItem, comments, related, generatedAt });
  await emit(content, { out: values.out, cwd });

  if (previousContent && storyChangedSinceLastFetch(previousContent, workItem.changedAt)) {
    console.log('context.md refreshed: story changed since last fetch');
  }
  return EXIT.OK;
}

async function runSearch(adapter, ctx, args, cwd) {
  const { values } = parseArgs(args, {
    text: { type: 'string' },
    type: { type: 'string' },
    top: { type: 'string', default: '10' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
  });
  if (!values.text) throw new UsageError('search requires --text "<query>"');

  const results = await adapter.search(ctx, { text: values.text, type: values.type, top: Number(values.top) });
  if (values.json) {
    await emit(JSON.stringify(results), { out: values.out, cwd });
    return EXIT.OK;
  }
  const content = results.length
    ? renderTable(
        ['ID', 'Type', 'State', 'Title'],
        results.map((item) => [item.id, item.type, item.state, item.title])
      )
    : 'No matching work items.';
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

async function runIteration(adapter, ctx, args, cwd) {
  const { values } = parseArgs(args, { out: { type: 'string' }, json: { type: 'boolean', default: false } });
  const iteration = await adapter.currentIteration(ctx);
  if (values.json) {
    await emit(JSON.stringify(iteration), { out: values.out, cwd });
    return EXIT.OK;
  }
  const content = iteration ? `Current iteration: ${iteration.path} (${iteration.start ?? '?'} – ${iteration.end ?? '?'})` : 'No current iteration found.';
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

/** `create` (design doc §5.1/D11): validates every entry, then either prints the
 * preview+hash (--dry-run) or creates the approved rows (--only, --expect-hash) one at a
 * time, writing each id/url back to --input immediately so a partial failure never loses
 * already-created rows and a rerun only creates the remainder. */
async function runCreate(adapter, ctx, args, cwd) {
  const { values } = parseArgs(args, {
    input: { type: 'string' },
    only: { type: 'string' },
    'expect-hash': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  });
  if (!values.input) throw new UsageError('create requires --input <file.json>');

  const inputPath = resolveSafePath(cwd, values.input);
  let items;
  let wasArray;
  try {
    ({ items, wasArray } = await readBatchInput(inputPath));
  } catch (err) {
    if (err.code === 'ENOENT') throw new UsageError(`--input not found: ${values.input}`);
    throw err;
  }
  validateEntries(items);

  const iteration = adapter.capabilities?.iterations ? await adapter.currentIteration(ctx) : null;

  if (values['dry-run']) {
    const preview = renderPreviewTable(items, { iterationPath: iteration?.path });
    if (!values.verbose) {
      await emit(preview, { out: values.out, cwd });
      return EXIT.OK;
    }
    const dryHttp = makeDryRunHttp();
    const dryCtx = { ...ctx, http: dryHttp };
    for (const item of items) {
      if (item.id) continue; // already created — nothing would be sent
      await adapter.create(dryCtx, [withoutRowLinks(resolveRowLinks(item, items))], { iterationPath: iteration?.path });
    }
    await emit(`${preview}\n\n${renderDryRun(dryHttp.calls)}`, { out: values.out, cwd });
    return EXIT.OK;
  }

  if (!values['expect-hash']) throw new UsageError('create (without --dry-run) requires --expect-hash <hash> from the preview.');
  const currentHash = computeHash(items);
  if (values['expect-hash'] !== currentHash) {
    console.error('input changed since preview - re-run --dry-run');
    return EXIT.USAGE;
  }

  const targetIndexes = parseOnlyRows(values.only, items.length)
    ?? items.map((_, index) => index).filter((index) => !items[index].id);

  const createdRows = [];
  for (const index of targetIndexes) {
    if (items[index].id) continue; // already created — reported as skipped below, never re-created
    const item = resolveRowLinks(items[index], items);
    try {
      const [created] = await adapter.create(ctx, [withoutRowLinks(item)], { iterationPath: iteration?.path });
      items[index] = { ...item, id: created.id, url: created.url };
      await writeBatchInput(inputPath, items, wasArray);
      createdRows.push({ row: index + 1, id: created.id, url: created.url });
    } catch (err) {
      const remaining = targetIndexes.slice(targetIndexes.indexOf(index)).map((i) => i + 1);
      console.error(`Created ${createdRows.length} row(s); stopped at row ${index + 1}: ${err.message}`);
      console.error(`Remaining rows: ${remaining.join(', ')}`);
      return EXIT.ERROR;
    }
  }

  // Links to a row created later in the file (or in an earlier run) are applied once both ends exist.
  const linkedRows = [];
  const pendingLinks = [];
  for (let index = 0; index < items.length; index++) {
    const rowLinks = (items[index].links ?? []).filter((link) => link.toRow !== undefined);
    if (!items[index].id || rowLinks.length === 0) continue;
    for (const link of rowLinks) {
      const target = items[link.toRow - 1];
      if (!target.id) {
        pendingLinks.push({ row: index + 1, toRow: link.toRow, relation: link.relation });
        continue;
      }
      try {
        await adapter.link(ctx, items[index].id, target.id, link.relation);
      } catch (err) {
        console.error(`Created ${createdRows.length} row(s); could not link row ${index + 1} to row ${link.toRow}: ${err.message}`);
        return EXIT.ERROR;
      }
      linkedRows.push({ row: index + 1, to: target.id, relation: link.relation });
    }
    items[index] = resolveRowLinks(items[index], items);
    await writeBatchInput(inputPath, items, wasArray);
  }

  const alreadyCreated = targetIndexes.filter((index) => items[index].id && !createdRows.some((row) => row.row === index + 1)).map((i) => i + 1);
  if (values.json) {
    await emit(JSON.stringify({ created: createdRows, alreadyCreated, linked: linkedRows, pendingLinks }), { out: values.out, cwd });
    return EXIT.OK;
  }
  const content = createdRows.length
    ? renderTable(['Row', 'ID', 'URL'], createdRows.map((row) => [row.row, row.id, row.url]))
    : 'No new rows to create (all selected rows were already created).';
  const notes = [
    ...linkedRows.map((link) => `linked: row ${link.row} --${link.relation}--> #${link.to}`),
    ...pendingLinks.map((link) => `link pending: row ${link.toRow} (${link.relation} link from row ${link.row}; create row ${link.toRow}, then rerun)`),
  ];
  await emit([content, ...notes].join('\n'), { out: values.out, cwd });
  return EXIT.OK;
}

/** `update <id> --input <file.json>` (design doc §5.1): sets a subset of {title,
 * description, descriptionAppend, acceptanceCriteria, state, tags} — never invents content,
 * only delivers what the input file already contains. `descriptionAppend` adds a section after
 * the current description without rewriting it, and cannot be combined with `description`. */
async function runUpdate(adapter, ctx, args, cwd) {
  const [idArg, ...flagArgs] = args;
  const id = requirePositiveIntId(idArg, 'update <id>');
  const { values } = parseArgs(flagArgs, {
    input: { type: 'string' },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  });
  if (!values.input) throw new UsageError('update requires --input <file.json>');

  const inputPath = resolveSafePath(cwd, values.input);
  let patch;
  try {
    patch = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new UsageError(`--input not found: ${values.input}`);
    throw new UsageError(`--input is not valid JSON: ${err.message}`);
  }
  const allowedKeys = ['title', 'description', 'descriptionAppend', 'acceptanceCriteria', 'state', 'tags'];
  const unknown = Object.keys(patch).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) throw new UsageError(`update --input has unsupported field(s): ${unknown.join(', ')}. Allowed: ${allowedKeys.join(', ')}`);
  if (patch.descriptionAppend !== undefined) {
    if (patch.description !== undefined) throw new UsageError('update --input cannot set both description and descriptionAppend');
    if (typeof patch.descriptionAppend !== 'string' || !patch.descriptionAppend.trim()) {
      throw new UsageError('update --input descriptionAppend must be non-empty markdown');
    }
  }

  const workItem = await adapter.update(ctx, id, patch);
  const content = values.json
    ? JSON.stringify(workItem)
    : `Updated ${workItem.type} #${workItem.id}: ${workItem.title} (${workItem.state})\n${workItem.url}`;
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

/** `comment <id> --body-file <file.md>` (design doc §5.1): posts model-written markdown as
 * a comment. */
async function runComment(adapter, ctx, args, cwd) {
  const [idArg, ...flagArgs] = args;
  const id = requirePositiveIntId(idArg, 'comment <id>');
  const { values } = parseArgs(flagArgs, {
    'body-file': { type: 'string' },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  });
  if (!values['body-file']) throw new UsageError('comment requires --body-file <file.md>');

  const dest = resolveSafePath(cwd, values['body-file']);
  let markdown;
  try {
    markdown = await readFile(dest, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new UsageError(`--body-file not found: ${values['body-file']}`);
    throw err;
  }
  const result = await adapter.addComment(ctx, id, markdown);
  const content = values.json ? JSON.stringify(result) : `Added comment ${result.id} to #${id}.`;
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

/** `link <id> --to <id> --relation <kind>` (design doc §5.1): idempotent — the adapter skips
 * the write when the relation already exists. Rejects relation kinds this tracker doesn't
 * support (exit 5) before ever calling the adapter. */
async function runLink(adapter, ctx, args, cwd) {
  const [idArg, ...flagArgs] = args;
  const id = requirePositiveIntId(idArg, 'link <id>');
  const { values } = parseArgs(flagArgs, {
    to: { type: 'string' },
    relation: { type: 'string' },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  });
  if (!values.to) throw new UsageError('link requires --to <id>');
  if (!values.relation) throw new UsageError('link requires --relation <kind>');
  const toId = requirePositiveIntId(values.to, '--to');

  if (!adapter.capabilities?.relations?.includes(values.relation)) {
    console.error(`Unsupported by this tracker (${ctx.config.tracker}): relation kind "${values.relation}".`);
    return EXIT.UNSUPPORTED;
  }

  await adapter.link(ctx, id, toId, values.relation);
  const content = values.json ? JSON.stringify({ ok: true, from: id, to: toId, relation: values.relation }) : `Linked #${id} --${values.relation}--> #${toId}.`;
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

/** `testcase <subcommand>` (design doc §5.1) — only `create` exists so far. */
async function runTestcase(adapter, ctx, args, cwd) {
  const [sub, ...rest] = args;
  if (sub !== 'create') throw new UsageError(`Unknown "testcase" subcommand "${sub ?? ''}". Available: create.`);
  return runTestcaseCreate(adapter, ctx, rest, cwd);
}

function validateTestCases(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new UsageError('testcase create --input must contain a non-empty array of test cases.');
  }
  const errors = [];
  items.forEach((item, index) => {
    const row = index + 1;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`Row ${row}: must be an object.`);
      return;
    }
    if (!item.title || typeof item.title !== 'string' || !item.title.trim()) errors.push(`Row ${row}: title is required.`);
    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      errors.push(`Row ${row}: steps must be a non-empty array.`);
    } else {
      item.steps.forEach((step, stepIndex) => {
        if (!step || typeof step.action !== 'string' || !step.action.trim()) {
          errors.push(`Row ${row}, step ${stepIndex + 1}: action is required.`);
        }
      });
    }
    if (item.priority !== undefined && (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 4)) {
      errors.push(`Row ${row}: priority must be an integer 1-4.`);
    }
  });
  if (errors.length > 0) throw new ValidationError(`testcase create --input has ${errors.length} error(s):\n${errors.join('\n')}`);
}

function positiveIdOrUndefined(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** `testcase create --input <file.json> [--link-to <id>] [--plan <id>] [--suite <id>] [--area <path>]`
 * (design doc §5.1): one ADO Test Case work item per entry, added to the chosen suite, placed in
 * the area, then linked to `--link-to` (the story under test) via a `tested-by` relation.
 * `--plan`/`--suite` fall back to `testPlan.planId`/`suiteId` and `--area` to `areaPath` in
 * tracker.config.json. Same two-step approval as `create`: `--dry-run` validates and prints a
 * preview table plus a hash (which also covers the plan, suite, area and story link); the real run
 * needs `--expect-hash` and refuses if anything changed since the preview. `--dry-run` sends
 * nothing and needs no sign-in. Auto-approved only for the story-scoped paths in the auto-approve
 * rules; every other use needs a human at the terminal. One row at a time (mirrors `runCreate`):
 * each created row's `id`/`url` is written back to `--input` once the whole row (work item, suite
 * add, link) succeeds, and a rerun skips rows that already have an `id`.
 *
 * Known gap: if the work item is created but the following suite or link call fails, the id is
 * not written back, so a rerun can create a duplicate. */
export async function runTestcaseCreate(adapter, ctx, args, cwd) {
  const { values } = parseArgs(args, {
    input: { type: 'string' },
    'link-to': { type: 'string' },
    plan: { type: 'string' },
    suite: { type: 'string' },
    area: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'expect-hash': { type: 'string' },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  });
  if (!values.input) throw new UsageError('testcase create requires --input <file.json>');
  const linkTo = values['link-to'] ? requirePositiveIntId(values['link-to'], '--link-to') : undefined;

  const configured = ctx.config.testPlan ?? {};
  const planId = values.plan ? requirePositiveIntId(values.plan, '--plan') : positiveIdOrUndefined(configured.planId);
  if (values.suite && !planId) {
    throw new UsageError('--suite needs a test plan: pass --plan <id> or set testPlan.planId in tracker.config.json.');
  }
  const suiteId = planId
    ? (values.suite ? requirePositiveIntId(values.suite, '--suite') : positiveIdOrUndefined(configured.suiteId))
    : undefined;

  if (values.area !== undefined && (!values.area.trim() || /[\u0000-\u001f]/.test(values.area))) {
    throw new UsageError('--area must be a non-empty area path without control characters.');
  }
  const areaPath = values.area?.trim() || (typeof ctx.config.areaPath === 'string' && ctx.config.areaPath.trim()) || undefined;

  const inputPath = resolveSafePath(cwd, values.input);
  let items;
  try {
    items = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new UsageError(`--input not found: ${values.input}`);
    throw new UsageError(`--input is not valid JSON: ${err.message}`);
  }
  validateTestCases(items);
  if (!suiteId) {
    console.error('warning: no test suite resolved (pass --suite or set testPlan.suiteId); test cases will be created without a suite.');
  }

  if (values['dry-run']) {
    await emit(renderTestCasePreview(items, { planId, suiteId, areaPath, linkTo }), { out: values.out, cwd });
    return EXIT.OK;
  }

  if (!values['expect-hash']) throw new UsageError('testcase create (without --dry-run) requires --expect-hash <hash> from the preview.');
  if (values['expect-hash'] !== computeTestCaseHash({ planId, suiteId, areaPath, linkTo, items })) {
    console.error('input changed since preview - re-run --dry-run');
    return EXIT.USAGE;
  }

  const createdRows = [];
  const alreadyCreated = [];
  for (const [index, item] of items.entries()) {
    if (item.id) {
      alreadyCreated.push(index + 1);
      continue;
    }
    try {
      const [created] = await adapter.createTestCases(ctx, [item], { linkTo, planId, suiteId, areaPath });
      items[index] = { ...item, id: created.id, url: created.url };
      await writeBatchInput(inputPath, items, true);
      createdRows.push({ row: index + 1, id: created.id, url: created.url });
    } catch (err) {
      console.error(`Created ${createdRows.length} test case(s); stopped at row ${index + 1}: ${err.message}`);
      return EXIT.ERROR;
    }
  }

  if (values.json) {
    await emit(JSON.stringify({ created: createdRows, alreadyCreated }), { out: values.out, cwd });
    return EXIT.OK;
  }
  const content = createdRows.length
    ? renderTable(['Row', 'ID', 'URL'], createdRows.map((row) => [row.row, row.id, row.url]))
    : 'No new test cases to create (all rows were already created).';
  await emit(content, { out: values.out, cwd });
  return EXIT.OK;
}

/** A ctx.http replacement for `create --dry-run --verbose` (D7): records the exact request
 * instead of sending it (Authorization redacted immediately) and returns a benign response so
 * the adapter's own mapping code runs unchanged. Exported for the §9.1 "token never appears
 * in --dry-run output" test. */
export function makeDryRunHttp() {
  const calls = [];
  const stub = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET', headers: redactHeaders(opts.headers ?? {}), body: opts.body });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 0 }), text: async () => '{}' };
  };
  return { request: stub, requestJson: stub, calls };
}

export function renderDryRun(calls) {
  const lines = ['DRY RUN — no requests were sent:'];
  for (const call of calls) {
    lines.push('', `${call.method} ${call.url}`);
    for (const [key, value] of Object.entries(call.headers)) lines.push(`${key}: ${value}`);
    if (call.body) lines.push(call.body);
  }
  return lines.join('\n');
}

function printHelp() {
  console.log(`tracker.mjs — tracker-neutral work item commands

Usage:
  node tracker.mjs auth-check [--json]
  node tracker.mjs fetch <id> [--comments 20] [--out <file>] [--json]
  node tracker.mjs search --text "<query>" [--type <type>] [--top 10] [--json]
  node tracker.mjs iteration [--json]
  node tracker.mjs create --input <file.json> --dry-run [--verbose]
  node tracker.mjs create --input <file.json> --expect-hash <hash> [--only 1,3,5]
  node tracker.mjs update <id> --input <file.json>
  node tracker.mjs comment <id> --body-file <file.md>
  node tracker.mjs link <id> --to <id> --relation <kind>
  node tracker.mjs testcase create --input <file.json> [--link-to <id>] [--plan <id>] [--suite <id>] [--area <path>] --dry-run
  node tracker.mjs testcase create --input <file.json> [--link-to <id>] [--plan <id>] [--suite <id>] [--area <path>] --expect-hash <hash>

update --input fields: title, description, descriptionAppend, acceptanceCriteria, state, tags (markdown).
descriptionAppend adds a section after the current description and leaves the existing content untouched.
create rows: links[] takes { relation, to: <id> } or { relation, toRow: <1-based row of the same file> };
a toRow link is applied once both rows exist (rerun create to pick up rows that were not selected).
`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run(process.argv.slice(2)).then((code) => process.exit(code ?? 0)).catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(EXIT.ERROR);
  });
}
