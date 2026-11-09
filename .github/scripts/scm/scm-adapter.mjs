// scm-adapter.mjs (GitHub Pull Requests) — Phase 2 (design doc §4.2, §8.2).
//
// Adapters are self-contained: every helper (auth header, http) is passed in via `ctx.lib`/
// `ctx.http` rather than imported, because this file is copied next to `adlc-lib/` only after
// `create-adlc` assembles the target repo — it doesn't live there in the monorepo.

export const vendor = 'github';

// GitHub's REST API cannot mark a PR ready for review — only GraphQL's
// markPullRequestReadyForReview can (§8.2). scm.mjs uses this to know it must resolve the
// PR's GraphQL node id (not just its number) before calling markReady.
export const capabilities = Object.freeze({ readyForReview: 'graphql' });

function headers(ctx) {
  return {
    ...ctx.lib.authHeader(ctx.auth),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function pullsUrl(ctx) {
  return `${ctx.target.apiBase}/repos/${ctx.target.owner}/${ctx.target.repo}/pulls`;
}

function mapPr(pr) {
  return {
    id: pr.number,
    nodeId: pr.node_id,
    url: pr.html_url,
    title: pr.title,
    body: pr.body ?? '',
    isDraft: Boolean(pr.draft),
    headRef: pr.head?.ref,
  };
}

export async function authCheck(ctx) {
  const user = await ctx.http.requestJson(`${ctx.target.apiBase}/user`, { headers: headers(ctx) });
  return { ok: true, identity: user.login };
}

/** Finds an open PR for `branch` (§5.2 idempotency check), or null if none exists. */
export async function findPrForBranch(ctx, branch) {
  const url = `${pullsUrl(ctx)}?head=${encodeURIComponent(`${ctx.target.owner}:${branch}`)}&state=open`;
  const results = await ctx.http.requestJson(url, { headers: headers(ctx) });
  const pr = (results ?? [])[0];
  return pr ? mapPr(pr) : null;
}

/** Fetches a specific PR by number — used by `pr-ready --pr <id>` to resolve the GraphQL node
 * id when the caller didn't just create/find the PR via another method. */
export async function getPrMeta(ctx, prId) {
  const pr = await ctx.http.requestJson(`${pullsUrl(ctx)}/${prId}`, { headers: headers(ctx) });
  return mapPr(pr);
}

export async function createPr(ctx, { title, body, source, target, draft = false }) {
  const payload = JSON.stringify({ title, body, head: source, base: target, draft: Boolean(draft) });
  const pr = await ctx.http.requestJson(pullsUrl(ctx), {
    method: 'POST',
    headers: { ...headers(ctx), 'Content-Type': 'application/json' },
    body: payload,
  });
  return mapPr(pr);
}

/** Idempotent update (§5.2): an existing open PR for the branch gets its title/body replaced
 * rather than a duplicate PR being created. */
export async function updatePr(ctx, prId, { title, body }) {
  const pr = await ctx.http.requestJson(`${pullsUrl(ctx)}/${prId}`, {
    method: 'PATCH',
    headers: { ...headers(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  });
  return mapPr(pr);
}

/** GitHub links work items via `Closes #n` / `AB#n` text already embedded in the PR body
 * (§8.3 linking matrix) — nothing to call here. */
export async function linkWorkItems() {
  return null;
}

/** Ready-for-review is GraphQL-only on GitHub (§8.2). `nodeId` is the PR's GraphQL node id
 * (from findPrForBranch/createPr/getPrMeta) — the REST `number` can't be used here. */
export async function markReady(ctx, prId, { nodeId } = {}) {
  if (!nodeId) throw new Error('markReady (GitHub): missing the PR GraphQL node id.');
  const query = 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }';
  const result = await ctx.http.requestJson(ctx.target.graphqlBase, {
    method: 'POST',
    headers: { ...headers(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: nodeId } }),
  });
  if (result?.errors?.length) {
    throw new Error(`GitHub GraphQL error marking PR ready: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  const pull = result.data.markPullRequestReadyForReview.pullRequest;
  return { id: pull.number, isDraft: pull.isDraft };
}

// --- Review & pipelines (Phase 5, design doc §4.2/§8.2/§5.2) ---

function repoBase(ctx) {
  return `${ctx.target.apiBase}/repos/${ctx.target.owner}/${ctx.target.repo}`;
}

/** Fetches metadata + diff + existing review threads for external review (`pr-fetch`, §5.2).
 * The diff comes from the `Accept: application/vnd.github.diff` media type (§8.2) — GitHub's
 * only way to get a real unified diff via REST. */
export async function getPr(ctx, prId) {
  const pr = await ctx.http.requestJson(`${pullsUrl(ctx)}/${prId}`, { headers: headers(ctx) });
  const diffRes = await ctx.http.request(`${pullsUrl(ctx)}/${prId}`, {
    headers: { ...headers(ctx), Accept: 'application/vnd.github.diff' },
  });
  const reviewComments = await ctx.http.requestJson(`${pullsUrl(ctx)}/${prId}/comments`, { headers: headers(ctx) });
  return {
    meta: mapPr(pr),
    diff: await diffRes.text(),
    threads: (reviewComments ?? []).map((c) => ({
      path: c.path ?? null,
      line: c.line ?? c.original_line ?? null,
      body: c.body ?? '',
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at ?? null,
    })),
  };
}

/** Posts review threads (`pr-comment`, never auto-approved, §7.3). `threads` with a `path`
 * are inline file comments — GitHub requires those in one review submission (`event:
 * COMMENT`, §8.2); threads without a `path` go to the general issue-comments endpoint. */
export async function addThreads(ctx, prId, threads = []) {
  const inline = threads.filter((t) => t.path);
  const general = threads.filter((t) => !t.path);

  if (inline.length > 0) {
    await ctx.http.request(`${pullsUrl(ctx)}/${prId}/reviews`, {
      method: 'POST',
      headers: { ...headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'COMMENT',
        comments: inline.map((t) => ({ path: t.path, line: t.line, side: 'RIGHT', body: t.body })),
      }),
    });
  }
  for (const thread of general) {
    await ctx.http.request(`${repoBase(ctx)}/issues/${prId}/comments`, {
      method: 'POST',
      headers: { ...headers(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: thread.body }),
    });
  }
}

/** Failed steps (trimmed log tail) for a GitHub Actions run (`build-logs`, §5.2/pipeline-debug
 * skill). GitHub Actions has no structured test-results REST API (§8.2) — `tests` always stays
 * empty; callers read the log tail instead. */
export async function getBuildFailure(ctx, buildId, { tail = 200 } = {}) {
  const jobsData = await ctx.http.requestJson(`${repoBase(ctx)}/actions/runs/${buildId}/jobs`, { headers: headers(ctx) });
  const failedJobs = (jobsData.jobs ?? []).filter((job) => job.conclusion === 'failure');

  const failedSteps = [];
  for (const job of failedJobs) {
    const failedStepNames = (job.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
    const logRes = await ctx.http.request(`${repoBase(ctx)}/actions/jobs/${job.id}/logs`, { headers: headers(ctx) });
    const text = await logRes.text();
    failedSteps.push({ name: failedStepNames.join(', ') || job.name, logTail: tailLines(stripAnsi(text), tail) });
  }

  const status = failedJobs.length > 0 ? 'failed' : ((jobsData.jobs ?? []).length ? 'succeeded' : 'unknown');
  return { status, failedSteps, tests: [] };
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}
