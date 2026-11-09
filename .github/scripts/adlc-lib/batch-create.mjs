// Batch create helpers (design doc §5.1 D11): validation, the preview-table hash, and the
// row-selection/write-back bookkeeping `tracker.mjs create` uses. Pure functions — no
// network, no exec — so the preview -> approve -> create flow is unit-testable without a
// live adapter.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export class ValidationError extends Error {}

export const RELATION_KINDS = ['parent', 'child', 'predecessor', 'successor', 'related', 'tested-by'];
export const SEVERITY_VALUES = ['1 - Critical', '2 - High', '3 - Medium', '4 - Low'];

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/** Deep-sorts object keys before JSON.stringify so the hash only reflects content, never key
 * order or formatting whitespace. Arrays keep their order (order is meaningful there). */
export function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortKeysDeep(value[key]);
      return acc;
    }, {});
  }
  return value;
}

/** sha256 of the normalized (canonicalized) input, first 12 hex chars (§5.1). Two loads of
 * the same logical content — regardless of key order/whitespace — hash identically; a
 * write-back that adds "id"/"url" fields changes the hash, which is intended (§5.1 step 4). */
export function computeHash(items) {
  return createHash('sha256').update(canonicalStringify(items)).digest('hex').slice(0, 12);
}

/** Loads a create --input file, wrapping a single object into a one-element array. Returns
 * `{ items, wasArray }` so writeBackIds can restore the original top-level shape. */
export async function readBatchInput(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(`--input is not valid JSON: ${err.message}`);
  }
  const wasArray = Array.isArray(parsed);
  const items = wasArray ? parsed : [parsed];
  if (items.length === 0) throw new ValidationError('--input contains no items to create.');
  return { items, wasArray };
}

/** Persists `items` back to `filePath`, restoring the original array/object shape. */
export async function writeBatchInput(filePath, items, wasArray) {
  const content = wasArray ? items : items[0];
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

function normalizeType(rawType) {
  const key = String(rawType ?? '').trim().toLowerCase();
  return key === 'story' || key === 'bug' ? key : null;
}

/** Validates one create-input entry (§5.1: required fields, enums, parent id format).
 * Returns an array of human-readable error strings (empty when valid). Tracker-neutral —
 * capability-specific relation support is the adapter's concern, not validated here. */
export function validateEntry(entry, index, total = Infinity) {
  const label = `row ${index + 1}`;
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${label}: must be a JSON object`];
  }

  const type = normalizeType(entry.type);
  if (!type) errors.push(`${label}: "type" must be "story" or "bug" (case-insensitive), got: ${JSON.stringify(entry.type ?? null)}`);
  if (!entry.title || typeof entry.title !== 'string' || !entry.title.trim()) errors.push(`${label}: "title" is required`);

  if (entry.parent !== undefined && !isPositiveInt(entry.parent)) errors.push(`${label}: "parent" must be a positive integer`);

  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links)) {
      errors.push(`${label}: "links" must be an array`);
    } else {
      entry.links.forEach((link, linkIndex) => {
        const linkLabel = `${label}: links[${linkIndex}]`;
        const hasTo = link && link.to !== undefined;
        const hasToRow = link && link.toRow !== undefined;
        if (hasTo && hasToRow) errors.push(`${linkLabel}: use either "to" or "toRow", not both`);
        else if (!hasToRow && (!link || !isPositiveInt(link.to))) errors.push(`${linkLabel}.to must be a positive integer (or use "toRow")`);
        if (hasToRow && !hasTo) {
          if (!isPositiveInt(link.toRow) || link.toRow > total) errors.push(`${linkLabel}.toRow must be a row number from 1 to ${total}`);
          else if (link.toRow === index + 1) errors.push(`${linkLabel}.toRow must be another row, not row ${link.toRow} itself`);
        }
        if (!link || !RELATION_KINDS.includes(link.relation)) {
          errors.push(`${linkLabel}.relation must be one of ${RELATION_KINDS.join(', ')}`);
        }
      });
    }
  }

  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== 'string'))) {
    errors.push(`${label}: "tags" must be an array of strings`);
  }

  // Per-item overrides of the config defaults (areaPath) and the current sprint (iterationPath).
  for (const key of ['areaPath', 'iterationPath']) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !entry[key].trim())) {
      errors.push(`${label}: "${key}" must be a non-empty string`);
    }
  }
  if (entry.systemInfo !== undefined) {
    if (type === 'story') errors.push(`${label}: "systemInfo" is only supported on bugs`);
    else if (typeof entry.systemInfo !== 'string' || !entry.systemInfo.trim()) errors.push(`${label}: "systemInfo" must be a non-empty string`);
  }

  if (type === 'bug') {
    if (entry.severity !== undefined && !SEVERITY_VALUES.includes(entry.severity)) {
      errors.push(`${label}: "severity" must be one of ${SEVERITY_VALUES.join(', ')}`);
    }
    if (entry.priority !== undefined && !(Number.isInteger(entry.priority) && entry.priority >= 1 && entry.priority <= 4)) {
      errors.push(`${label}: "priority" must be an integer 1-4`);
    }
    if (entry.reproSteps !== undefined && (!Array.isArray(entry.reproSteps) || entry.reproSteps.some((step) => typeof step !== 'string'))) {
      errors.push(`${label}: "reproSteps" must be an array of strings`);
    }
  }

  return errors;
}

/** Validates every entry; throws ValidationError joining all issues (one message, every
 * offending row) so a batch preview reports everything wrong in one pass. */
export function validateEntries(items) {
  const errors = items.flatMap((entry, index) => validateEntry(entry, index, items.length));
  if (errors.length > 0) throw new ValidationError(errors.join('\n'));
}

function countAcItems(entry) {
  const type = normalizeType(entry.type);
  if (type === 'bug') return Array.isArray(entry.reproSteps) ? entry.reproSteps.length : 0;
  if (!entry.acceptanceCriteria) return 0;
  return entry.acceptanceCriteria.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function describeLink(link) {
  return `${link.relation}: ${link.toRow !== undefined ? `row ${link.toRow}` : `#${link.to}`}`;
}

/** Renders the D11 preview table (`# | Type | Title | Parent | AC items | Iteration | Tags |
 * Status`, plus `Depends on` when any row has links) and the `hash:` line the human approves
 * against. `iterationPath` is resolved once for the whole batch (read-only `currentIteration()`
 * call), not per row. */
export function renderPreviewTable(items, { iterationPath } = {}) {
  const showLinks = items.some((entry) => Array.isArray(entry.links) && entry.links.length > 0);
  const rows = items.map((entry, index) => {
    const cells = [
      String(index + 1),
      normalizeType(entry.type) ?? String(entry.type ?? ''),
      entry.title ?? '',
      entry.parent ?? '',
      String(countAcItems(entry)),
      entry.iterationPath ?? iterationPath ?? 'n/a',
      (entry.tags ?? []).join(', '),
    ];
    if (showLinks) cells.push((Array.isArray(entry.links) ? entry.links : []).map(describeLink).join(', '));
    cells.push(entry.id ? `already created #${entry.id}` : 'new');
    return cells;
  });
  const header = ['#', 'Type', 'Title', 'Parent', 'AC items', 'Iteration', 'Tags', ...(showLinks ? ['Depends on'] : []), 'Status'];
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const table = [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
  return `${table}\n\nhash: ${computeHash(items)}`;
}

/** Hash the human approves for `testcase create`. It covers the target plan, suite, area and story
 * link as well as the cases, so changing any of them after the preview invalidates the approval. */
export function computeTestCaseHash({ planId, suiteId, areaPath, linkTo, items }) {
  return computeHash({ planId, suiteId, areaPath, linkTo, items });
}

/** Renders the `testcase create` preview (`# | Title | Steps | Priority | Automated | Suite |
 * Status`), the area the cases land in, and the `hash:` line to approve against. */
export function renderTestCasePreview(items, { planId, suiteId, areaPath, linkTo } = {}) {
  const header = ['#', 'Title', 'Steps', 'Priority', 'Automated', 'Suite', 'Status'];
  const rows = items.map((item, index) => [
    String(index + 1),
    item.title ?? '',
    String(Array.isArray(item.steps) ? item.steps.length : 0),
    item.priority ?? '',
    item.automated ?? '',
    suiteId ?? 'none',
    item.id ? `already created #${item.id}` : 'new',
  ]);
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const table = [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
  return `${table}\n\narea: ${areaPath ?? 'none'}\nhash: ${computeTestCaseHash({ planId, suiteId, areaPath, linkTo, items })}`;
}

/** Parses `--only 1,3,5` (1-based row numbers matching the preview table's `#` column) into
 * 0-based indices, validating every number is a positive integer within range. */
export function parseOnlyRows(raw, totalRows) {
  if (!raw) return null;
  return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > totalRows) {
      throw new ValidationError(`--only: "${part}" is not a valid row number (expected 1-${totalRows})`);
    }
    return n - 1;
  });
}

/** Replaces each `toRow` link whose target row already has an `id` by `to: <id>`. Returns the
 * item unchanged when nothing resolves. */
export function resolveRowLinks(item, items) {
  if (!Array.isArray(item.links) || !item.links.some((link) => link.toRow !== undefined)) return item;
  const links = item.links.map((link) => {
    const target = link.toRow !== undefined ? items[link.toRow - 1] : null;
    if (!target?.id) return link;
    const { toRow, ...rest } = link;
    return { ...rest, to: target.id };
  });
  return { ...item, links };
}

/** The item as the adapter sees it: links that still point at a row (`toRow`) are left out, they
 * are applied with `link()` once both rows exist. */
export function withoutRowLinks(item) {
  if (!Array.isArray(item.links) || !item.links.some((link) => link.toRow !== undefined)) return item;
  return { ...item, links: item.links.filter((link) => link.toRow === undefined) };
}
