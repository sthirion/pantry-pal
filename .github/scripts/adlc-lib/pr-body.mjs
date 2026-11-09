// PR body composition helpers (design doc §8.3): the work-item linking matrix and the character
// budgets that apply to every SCM. The body has no file list: the PR's Files view already shows
// every change. Pure functions — no network, no exec — so they're unit-testable without mocking
// anything.

// ADO caps a PR description at 4000 characters. The model-written body (summary, review guide,
// merge checklist) gets most of it; the rest is headroom for work-item link lines.
export const MODEL_BODY_LIMIT = 2400;
export const TOTAL_LIMIT = 4000;

export class PrBodyError extends Error {}

/** Builds the work-item link lines/refs for a PR body per the §8.3 matrix. `workItemIds` are
 * already-validated positive integers. Returns `{ bodyLines, workItemRefs, warning }`:
 * - `bodyLines`: markdown lines to append to the PR body (empty when linking is done via
 *   `workItemRefs` instead, or when linking isn't possible).
 * - `workItemRefs`: string ids to pass as `workItemRefs` on ADO SCM create (ADO tracker only),
 *   or null when not applicable.
 * - `warning`: a one-line warning to print (unsupported combo, or no tracker configured), or
 *   null. */
export function buildWorkItemLinks({ trackerType, scmVendor, workItemIds = [] }) {
  if (workItemIds.length === 0) return { bodyLines: [], workItemRefs: null, warning: null };

  if (!trackerType) {
    return {
      bodyLines: [],
      workItemRefs: null,
      warning: 'No tracker configured (tracker.config.json not found) - work items were not linked.',
    };
  }
  if (trackerType === 'github' && scmVendor === 'github') {
    return { bodyLines: workItemIds.map((id) => `Closes #${id}`), workItemRefs: null, warning: null };
  }
  if (trackerType === 'ado' && scmVendor === 'github') {
    return { bodyLines: workItemIds.map((id) => `AB#${id}`), workItemRefs: null, warning: null };
  }
  if (trackerType === 'ado' && scmVendor === 'ado') {
    return { bodyLines: [], workItemRefs: workItemIds.map(String), warning: null };
  }
  return {
    bodyLines: [],
    workItemRefs: null,
    warning: `Unsupported combination: ${trackerType} tracker + ${scmVendor} SCM - work items were not linked.`,
  };
}

/** Validates the model-written body against the §5.2 budget. Throws PrBodyError (map to exit
 * 2) with the exact message the plan mandates — never silently truncates model text. */
export function assertModelBodyBudget(body) {
  const length = (body ?? '').length;
  if (length > MODEL_BODY_LIMIT) {
    throw new PrBodyError(`PR body is ${length} chars; limit ${MODEL_BODY_LIMIT} - shorten the summary`);
  }
}

/** Composes the final PR body (model body + work-item link lines) and validates the total
 * against TOTAL_LIMIT (§5.2, enforced on every SCM). Returns the final markdown string; throws
 * PrBodyError if the total still exceeds the cap (e.g. an unreasonably long `--work-items`
 * list). */
export function composeBody({ modelBody, linkLines = [] }) {
  const parts = [modelBody.trim()];
  if (linkLines.length > 0) parts.push(linkLines.join('\n'));
  const composed = parts.join('\n\n');
  if (composed.length > TOTAL_LIMIT) {
    throw new PrBodyError(`Total PR body would be ${composed.length} chars; limit ${TOTAL_LIMIT} - reduce --work-items or shorten the summary`);
  }
  return composed;
}
