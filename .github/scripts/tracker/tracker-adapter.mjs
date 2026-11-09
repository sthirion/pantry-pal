// tracker-adapter.mjs (GitHub Issues) — read methods for Phase 1 (design doc §4.2, §8.2).
//
// Verified in Phase 0 against the public cli/cli repo (see plan "Phase 0 findings"):
// - `parent` 404 "No parent issue found" means no parent, not a missing API.
// - `sub_issues`, `dependencies/blocked_by`, `dependencies/blocking`, `timeline` all 200.
// - Issue comments ignore `sort`/`direction` — always oldest first; sort newest-first here.
//
// Adapters are self-contained: every helper (HTML/markdown, auth header, exec) is passed in
// via `ctx.lib` rather than imported, because this file is copied next to `adlc-lib/` only
// after `create-adlc` assembles the target repo — it doesn't live there in the monorepo.

export const capabilities = Object.freeze({
  testCases: false,
  iterations: false,
  relations: ['parent', 'child', 'predecessor', 'successor', 'related'],
});

function headers(ctx) {
  return {
    ...ctx.lib.authHeader(ctx.auth),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function issueUrl(ctx, id) {
  return `${ctx.target.apiBase}/repos/${ctx.target.owner}/${ctx.target.repo}/issues/${id}`;
}

async function fetchJsonOrNull(ctx, url) {
  try {
    return await ctx.http.requestJson(url, { headers: headers(ctx) });
  } catch (err) {
    if (err.status === 404 || err.status === 410) return null; // endpoint says "not found" — omit, don't fail (§8.2)
    throw err;
  }
}

function extractAcceptanceCriteria(body) {
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Acceptance Criteria\s*$/i.test(line.trim()));
  if (start === -1) return '';
  const collected = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    collected.push(lines[i]);
  }
  return collected.join('\n').trim();
}

function stripAcceptanceCriteria(body) {
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Acceptance Criteria\s*$/i.test(line.trim()));
  if (start === -1) return body;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim();
}

function mapIssueToWorkItem(issue) {
  return {
    id: issue.number,
    type: issue.pull_request ? 'Pull Request' : 'Issue',
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    description: stripAcceptanceCriteria(issue.body),
    acceptanceCriteria: extractAcceptanceCriteria(issue.body),
    tags: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
    createdAt: issue.created_at,
    changedAt: issue.updated_at,
    relations: [],
  };
}

async function fetchRelations(ctx, id) {
  const relations = [];

  const parent = await fetchJsonOrNull(ctx, `${issueUrl(ctx, id)}/parent`);
  if (parent) relations.push({ kind: 'parent', id: parent.number, url: parent.html_url, comment: '', addedAt: null });

  const children = (await fetchJsonOrNull(ctx, `${issueUrl(ctx, id)}/sub_issues`)) ?? [];
  for (const child of children) relations.push({ kind: 'child', id: child.number, url: child.html_url, comment: '', addedAt: null });

  const blockedBy = (await fetchJsonOrNull(ctx, `${issueUrl(ctx, id)}/dependencies/blocked_by`)) ?? [];
  for (const item of blockedBy) relations.push({ kind: 'predecessor', id: item.number, url: item.html_url, comment: '', addedAt: null });

  const blocking = (await fetchJsonOrNull(ctx, `${issueUrl(ctx, id)}/dependencies/blocking`)) ?? [];
  for (const item of blocking) relations.push({ kind: 'successor', id: item.number, url: item.html_url, comment: '', addedAt: null });

  const timeline = (await fetchJsonOrNull(ctx, `${issueUrl(ctx, id)}/timeline?per_page=100`)) ?? [];
  for (const event of timeline) {
    if (event.event !== 'cross-referenced' || !event.source?.issue) continue;
    const source = event.source.issue;
    if (source.number === id) continue;
    relations.push({ kind: 'related', id: source.number, url: source.html_url, comment: 'cross-referenced', addedAt: event.created_at ?? null });
  }

  return relations;
}

export async function authCheck(ctx) {
  const user = await ctx.http.requestJson(`${ctx.target.apiBase}/user`, { headers: headers(ctx) });
  return { ok: true, identity: user.login };
}

export async function getWorkItem(ctx, id) {
  const issue = await ctx.http.requestJson(issueUrl(ctx, id), { headers: headers(ctx) });
  const workItem = mapIssueToWorkItem(issue);
  workItem.relations = await fetchRelations(ctx, id);
  return workItem;
}

export async function getComments(ctx, id, { top = 20 } = {}) {
  const perPage = 100;
  const baseUrl = `${issueUrl(ctx, id)}/comments?per_page=${perPage}`;
  const first = await ctx.http.request(`${baseUrl}&page=1`, { headers: headers(ctx) });
  const items = await first.json();
  const lastPage = parseLastPage(first.headers.get('link'));

  const all = [...items];
  for (let page = 2; lastPage && page <= lastPage; page++) {
    const res = await ctx.http.request(`${baseUrl}&page=${page}`, { headers: headers(ctx) });
    all.push(...(await res.json()));
  }

  return all
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, top)
    .map((comment) => ({ author: comment.user?.login ?? 'unknown', createdAt: comment.created_at, markdown: comment.body ?? '' }));
}

function parseLastPage(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

/** Batch-resolves relation stubs ({ id, kind }) into WorkItemSummary-shaped objects (depth 1
 * only — the caller never recurses). A relation whose target 404s (deleted/no access) is
 * omitted rather than failing the whole fetch. */
export async function getRelated(ctx, relations) {
  const summaries = [];
  for (const relation of relations) {
    const issue = await fetchJsonOrNull(ctx, issueUrl(ctx, relation.id));
    if (!issue) continue;
    summaries.push({
      kind: relation.kind,
      id: issue.number,
      type: issue.pull_request ? 'Pull Request' : 'Issue',
      state: issue.state,
      title: issue.title,
      url: issue.html_url,
      descriptionExcerpt: (issue.body ?? '').slice(0, 500),
    });
  }
  return summaries;
}

export async function search(ctx, { text, top = 10 } = {}) {
  const query = encodeURIComponent(`repo:${ctx.target.owner}/${ctx.target.repo} is:issue in:title ${text}`);
  const url = `${ctx.target.apiBase}/search/issues?q=${query}&per_page=${top}`;
  const result = await ctx.http.requestJson(url, { headers: headers(ctx) });
  return (result.items ?? []).map((issue) => ({
    id: issue.number,
    type: issue.pull_request ? 'Pull Request' : 'Issue',
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    descriptionExcerpt: (issue.body ?? '').slice(0, 500),
  }));
}

/** GitHub Issues has no iteration/sprint concept — tracker.mjs checks `capabilities.iterations`
 * before ever calling this and exits 5 instead. */
export async function currentIteration() {
  return null;
}

// --- Write methods (Phase 3, design doc §5.1/§8.2) --------------------------------------

function resolveLabels(ctx, item) {
  const type = String(item.type ?? '').trim().toLowerCase();
  const base = type === 'bug' ? (ctx.config.bugLabels ?? []) : (ctx.config.storyLabels ?? []);
  return [...new Set([...base, ...(item.tags ?? [])])];
}

/** Bug body follows the `### Steps to reproduce` / `### Expected` / `### Actual` /
 * `### Environment` convention the shrunk gh-create-issue skill documents. */
function renderBugBody(item) {
  const parts = [];
  if (item.description) parts.push(item.description.trim());
  if (Array.isArray(item.reproSteps) && item.reproSteps.length > 0) {
    parts.push(`### Steps to reproduce\n\n${item.reproSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  }
  if (item.expected) parts.push(`### Expected\n\n${item.expected}`);
  if (item.actual) parts.push(`### Actual\n\n${item.actual}`);
  if (item.environment) parts.push(`### Environment\n\n${item.environment}`);
  return parts.join('\n\n') || item.title;
}

/** Story body uses the `## Acceptance Criteria` header `extractAcceptanceCriteria` (above)
 * already knows how to read back on fetch. */
function renderStoryBody(item) {
  const parts = [];
  if (item.description) parts.push(item.description.trim());
  if (item.acceptanceCriteria) parts.push(`## Acceptance Criteria\n\n${item.acceptanceCriteria.trim()}`);
  return parts.join('\n\n') || item.title;
}

function renderIssueBody(item) {
  return String(item.type ?? '').trim().toLowerCase() === 'bug' ? renderBugBody(item) : renderStoryBody(item);
}

async function fetchIssueId(ctx, number) {
  const issue = await ctx.http.requestJson(issueUrl(ctx, number), { headers: headers(ctx) });
  return issue.id; // database id — required by sub_issues/dependencies, distinct from `number`
}

/** `create(ctx, items)` — one issue POST per item (the batch loop lives in tracker.mjs, one
 * row at a time). Parent/links are applied via `link()` right after creation so the two code
 * paths (create-time vs standalone `link`) share one implementation. */
export async function create(ctx, items) {
  const results = [];
  for (const item of items) {
    const url = `${ctx.target.apiBase}/repos/${ctx.target.owner}/${ctx.target.repo}/issues`;
    const body = JSON.stringify({ title: item.title, body: renderIssueBody(item), labels: resolveLabels(ctx, item) });
    const issue = await ctx.http.requestJson(url, { method: 'POST', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body });

    if (item.parent) await link(ctx, issue.number, item.parent, 'parent');
    for (const rel of item.links ?? []) await link(ctx, issue.number, rel.to, rel.relation);

    results.push({ id: issue.number, url: issue.html_url });
  }
  return results;
}

function replaceAcSection(body, acceptanceCriteria) {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Acceptance Criteria\s*$/i.test(line.trim()));
  const acBlock = `## Acceptance Criteria\n\n${acceptanceCriteria.trim()}`;
  if (start === -1) {
    const trimmed = (body ?? '').trim();
    return trimmed ? `${trimmed}\n\n${acBlock}` : acBlock;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const before = lines.slice(0, start).join('\n').trimEnd();
  const after = lines.slice(end).join('\n').trimStart();
  return [before, acBlock, after].filter(Boolean).join('\n\n');
}

function replaceDescription(body, description) {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Acceptance Criteria\s*$/i.test(line.trim()));
  if (start === -1) return description.trim();
  const rest = lines.slice(start).join('\n');
  return `${description.trim()}\n\n${rest}`;
}

function insertBeforeAcSection(body, markdown) {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Acceptance Criteria\s*$/i.test(line.trim()));
  if (start === -1) {
    const trimmed = (body ?? '').trim();
    return trimmed ? `${trimmed}\n\n${markdown.trim()}` : markdown.trim();
  }
  const before = lines.slice(0, start).join('\n').trimEnd();
  const rest = lines.slice(start).join('\n');
  return [before, markdown.trim(), rest].filter(Boolean).join('\n\n');
}

/** `update(ctx, id, patch)` — GitHub has one body field, so description/AC updates read the
 * current body first and replace only their own section (`replaceAcSection`/
 * `replaceDescription`), leaving the rest of the body untouched. `descriptionAppend` inserts
 * before the AC section; GitHub has no optimistic-concurrency check, so a concurrent edit
 * between the read and the write is lost. `tags` replaces the full label set (already
 * restricted to {title, description, descriptionAppend, acceptanceCriteria, state, tags} by
 * tracker.mjs). */
export async function update(ctx, id, patch) {
  const needsBody = patch.description !== undefined || patch.descriptionAppend !== undefined || patch.acceptanceCriteria !== undefined;
  const current = needsBody ? await ctx.http.requestJson(issueUrl(ctx, id), { headers: headers(ctx) }) : null;

  const payload = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.state !== undefined) payload.state = patch.state;
  if (patch.tags !== undefined) payload.labels = patch.tags;

  let body = current?.body ?? '';
  if (patch.description !== undefined) body = replaceDescription(body, patch.description);
  if (patch.descriptionAppend !== undefined) body = insertBeforeAcSection(body, patch.descriptionAppend);
  if (patch.acceptanceCriteria !== undefined) body = replaceAcSection(body, patch.acceptanceCriteria);
  if (needsBody) payload.body = body;

  const issue = await ctx.http.requestJson(issueUrl(ctx, id), {
    method: 'PATCH', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return mapIssueToWorkItem(issue);
}

/** `addComment(ctx, id, markdown)` — GitHub comment bodies are markdown natively, no
 * conversion needed (unlike ADO). */
export async function addComment(ctx, id, markdown) {
  const url = `${issueUrl(ctx, id)}/comments`;
  const data = await ctx.http.requestJson(url, { method: 'POST', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ body: markdown }) });
  return { id: data.id };
}

/** `link(ctx, fromId, toId, relation)` — idempotent (checks `fetchRelations` first).
 * parent/child use the well-documented `sub_issues` API (Phase 0-verified). predecessor/
 * successor use `dependencies/blocked_by|blocking` — *** UNVERIFIED BEYOND THE GET SIDE ***
 * (Phase 0 only confirmed the read path returns 200; the POST body shape here is inferred
 * from GitHub's docs, not exercised against a live repo). related has no dedicated link API,
 * so it posts a comment mentioning the target issue, which GitHub turns into a natural
 * cross-reference that `fetchRelations`' timeline scan already reads back. */
export async function link(ctx, fromId, toId, relation) {
  const existing = await fetchRelations(ctx, fromId);
  if (existing.some((rel) => rel.kind === relation && rel.id === toId)) return { ok: true, alreadyLinked: true };

  if (relation === 'parent') {
    const subIssueId = await fetchIssueId(ctx, fromId);
    await ctx.http.requestJson(`${issueUrl(ctx, toId)}/sub_issues`, {
      method: 'POST', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ sub_issue_id: subIssueId }),
    });
    return { ok: true, alreadyLinked: false };
  }
  if (relation === 'child') {
    const subIssueId = await fetchIssueId(ctx, toId);
    await ctx.http.requestJson(`${issueUrl(ctx, fromId)}/sub_issues`, {
      method: 'POST', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ sub_issue_id: subIssueId }),
    });
    return { ok: true, alreadyLinked: false };
  }
  if (relation === 'predecessor' || relation === 'successor') {
    const kind = relation === 'predecessor' ? 'blocked_by' : 'blocking';
    const targetId = await fetchIssueId(ctx, toId);
    await ctx.http.requestJson(`${issueUrl(ctx, fromId)}/dependencies/${kind}`, {
      method: 'POST', headers: { ...headers(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ issue_id: targetId }),
    });
    return { ok: true, alreadyLinked: false };
  }
  if (relation === 'related') {
    await addComment(ctx, fromId, `Related: #${toId}`);
    return { ok: true, alreadyLinked: false };
  }
  throw new Error(`Unsupported relation kind for GitHub: ${relation}`);
}

/** GitHub Issues has no test-case concept — tracker.mjs checks `capabilities.testCases`
 * before ever calling this and exits 5 instead. */
export async function createTestCases() {
  throw new Error('GitHub Issues has no test case concept.');
}
