import { DatabaseSync } from 'node:sqlite';

/**
 * BOB-99: mirrors every open Kanbanger issue onto Bob's SDLC edge, with each issue's Forgejo
 * pull request (CI checks, merged). The shape it posts is IssueBatch / TrackedIssue in
 * packages/bob/src/sdlc-view/src/issues.ts; keep the two in step.
 *
 * Self-paced: the worker calls step() every loop. An incremental pass (issues updated since
 * the cursor, minus an overlap) runs every intervalMs; a full sync (every open issue, plus
 * Done/Canceled from the last 24 h) every fullSyncMs, ending with `complete: { ids }` so the
 * edge drops what Kanbanger no longer lists. Only issues whose version changed are posted.
 *
 * Read-only towards Kanbanger and Forgejo. State lives in its own tables in the edge
 * checkpoint database, never in the coordinator's. Logs counts only: no titles, tokens or
 * user ids.
 */
export const MIRROR_INTERVAL_MS = 30_000;
export const MIRROR_FULL_SYNC_MS = 10 * 60_000;
/** An incremental pass re-reads this much before the cursor (clock skew, slow writes). */
export const MIRROR_OVERLAP_MS = 2 * 60_000;
/** Done/Canceled issues stay on the floor this long. */
export const DONE_WINDOW_MS = 24 * 3_600_000;
/** An open PR is re-read at most this often unless its issue changes. */
export const PR_REFRESH_MS = 5 * 60_000;
/** Mirrors MAX_ISSUES_PER_BATCH in sdlc-view issues.ts. */
export const MAX_ISSUES_PER_BATCH = 400;
/** Mirrors TITLE_MAX in sdlc-view issues.ts. */
export const TITLE_MAX = 160;
const PAGE = 100, MAX_PAGES = 200, PR_CONCURRENCY = 4;
const STATE_TYPES = new Set(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']);
const KEY = /^[A-Z][A-Z0-9]{0,19}-\d{1,9}$/;
const SHA = /^[a-f0-9]{40}$/;

const clip = (v, max) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);
const httpsOrNull = v => { if (typeof v !== 'string' || v.length > 2000) return null; try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; } };
const ms = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** The issue's team and project are one of the policy's issueProjects (as kanbangerIssueResolver checks). Returns that entry, or null. */
export function policyProjectFor(policy, node) {
  const projectId = node?.project?.id;
  if (!projectId) return null;
  return (policy?.issueProjects ?? []).find(p => p.integrationId === 'kanbanger' && p.projectId === projectId && (p.teamId === node.team?.id || (node.team?.key != null && p.teamId === node.team.key))) ?? null;
}
export const dispatchableUnder = (policy, node) => policyProjectFor(policy, node) !== null;

/** The first attachment that is a pull request on this Forgejo instance: { repo, number, url } or null. */
export function prLinkOf(node, origin) {
  if (!origin) return null;
  for (const attachment of node?.attachments?.nodes ?? []) {
    const url = attachment?.url;
    if (typeof url !== 'string') continue;
    let parsed; try { parsed = new URL(url); } catch { continue; }
    if (parsed.origin !== origin) continue;
    const match = /^\/([\w.-]{1,100})\/([\w.-]{1,100})\/pulls\/(\d{1,9})\/?$/.exec(parsed.pathname);
    if (match) return { repo: `${match[1]}/${match[2]}`, number: Number(match[3]), url: `${origin}/${match[1]}/${match[2]}/pulls/${match[3]}` };
  }
  return null;
}

/** Kanbanger node → TrackedIssue (pr null; see withPr). Null when it cannot be shown. */
export function trackedIssueOf(node, policy) {
  if (!node || typeof node.id !== 'string' || !node.id || node.id.length > 200 || typeof node.identifier !== 'string' || !KEY.test(node.identifier)) return null;
  if (node.archivedAt) return null;
  const type = node.state?.type;
  const updatedAt = ms(node.updatedAt);
  if (!STATE_TYPES.has(type) || typeof node.state?.name !== 'string' || updatedAt === null) return null;
  return {
    id: node.id, key: node.identifier, title: clip(typeof node.title === 'string' ? node.title : '', TITLE_MAX), url: httpsOrNull(node.url),
    state: { name: clip(node.state.name, 100), type },
    project: node.project?.id ? { id: node.project.id, name: clip(typeof node.project.name === 'string' ? node.project.name : '', 100) } : null,
    team: typeof node.team?.key === 'string' ? node.team.key.slice(0, 20) : null,
    updatedAt, pr: null, dispatchable: dispatchableUnder(policy, node), version: updatedAt,
  };
}

export const withPr = (issue, pr) => ({ ...issue, pr, version: Math.max(issue.updatedAt, pr?.checkedAt ?? 0) });
/** The PR's content, without when it was read: what decides whether anything changed. */
const prContent = pr => (pr ? JSON.stringify([pr.repo, pr.number, pr.state, pr.checks, pr.headSha]) : 'null');

/** Forgejo reader for one PR: { state, checks, headSha }, or throws. Checks only for open PRs. */
export function forgejoPrReader({ instanceUrl, token, fetch: transport = fetch, timeoutMs = 10_000 }) {
  const base = instanceUrl.replace(/\/+$/, '');
  const get = async path => {
    const response = await transport(`${base}${path}`, { headers: { authorization: `token ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Forgejo HTTP ${response.status}`), { status: response.status }); }
    return response.json();
  };
  const repoPath = repo => repo.split('/').map(encodeURIComponent).join('/');
  return async ({ repo, number }) => {
    const pr = await get(`/api/v1/repos/${repoPath(repo)}/pulls/${number}`);
    const state = pr?.merged === true ? 'merged' : pr?.state === 'closed' ? 'closed' : 'open';
    const headSha = SHA.test(pr?.head?.sha ?? '') ? pr.head.sha : null;
    let checks = null;
    if (state === 'open' && headSha) {
      const status = await get(`/api/v1/repos/${repoPath(repo)}/commits/${headSha}/status`);
      const any = Array.isArray(status?.statuses) && status.statuses.length > 0;
      checks = !any ? null : status.state === 'success' || status.state === 'warning' ? 'success' : status.state === 'failure' || status.state === 'error' ? 'failure' : 'pending';
    }
    return { state, checks, headSha };
  };
}

/**
 * kanbanger: kanbangerClient (listIssues, mirrorIssue). policy: the coordinator's context
 * (issueProjects). endpoint: the edge's /api/sdlc/ingest URL; batches go to /api/sdlc/issues
 * at the same origin. forgejo: { instanceUrl, token } or null (then pr stays null).
 * readPr overrides the Forgejo reader (tests).
 */
export function issueMirror({ kanbanger, policy, endpoint, token, checkpoint, forgejo = null, readPr, fetch: send = fetch, now = Date.now, intervalMs = MIRROR_INTERVAL_MS, fullSyncMs = MIRROR_FULL_SYNC_MS, timeoutMs = 10_000, log = line => console.error(JSON.stringify(line)) }) {
  const ingest = new URL(endpoint);
  if (ingest.protocol !== 'https:' || ingest.pathname !== '/api/sdlc/ingest') throw new Error('Issue mirror needs the edge\'s HTTPS /api/sdlc/ingest endpoint');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !checkpoint || checkpoint === ':memory:') throw new Error('Invalid issue mirror configuration');
  const url = new URL('/api/sdlc/issues', ingest.origin).href;
  const origin = forgejo ? new URL(forgejo.instanceUrl).origin : null;
  const read = readPr ?? (forgejo ? forgejoPrReader({ ...forgejo, fetch: send, timeoutMs }) : null);
  const db = new DatabaseSync(checkpoint);
  db.exec('CREATE TABLE IF NOT EXISTS issue_mirror_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
  // The last copy sent per issue: its version, and the issue itself so an open PR can be re-read without Kanbanger.
  db.exec('CREATE TABLE IF NOT EXISTS issue_mirror_sent (id TEXT PRIMARY KEY, version INTEGER NOT NULL, issue TEXT NOT NULL)');
  // PR cache: pr = the TrackedPr last produced (checkedAt = when its content last changed); read_at = last read.
  db.exec('CREATE TABLE IF NOT EXISTS issue_mirror_pr (issue_id TEXT PRIMARY KEY, url TEXT NOT NULL, issue_updated_at INTEGER NOT NULL, pr TEXT NOT NULL, read_at INTEGER NOT NULL)');
  const meta = key => db.prepare('SELECT value FROM issue_mirror_meta WHERE key=?').get(key)?.value ?? null;
  const setMeta = (key, value) => db.prepare('INSERT INTO issue_mirror_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  const sentRow = id => db.prepare('SELECT version, issue FROM issue_mirror_sent WHERE id=?').get(id);
  const refreshQueue = new Set();

  async function pages(filter) {
    const out = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await kanbanger.listIssues(filter, after, PAGE);
      out.push(...result.nodes);
      if (!result.hasNextPage || !result.endCursor) return out;
      after = result.endCursor;
    }
    throw new Error('Issue mirror: too many pages');
  }

  /** The PR for one issue: cached while fresh, else read. A failed read keeps the cached PR. */
  async function prFor(issue, link, force) {
    if (!link || !read) return null;
    const cached = db.prepare('SELECT url, issue_updated_at, pr, read_at FROM issue_mirror_pr WHERE issue_id=?').get(issue.id);
    const previous = cached && cached.url === link.url ? JSON.parse(cached.pr) : null;
    const fresh = previous && cached.issue_updated_at === issue.updatedAt && !force && (previous.state !== 'open' || now() - cached.read_at < PR_REFRESH_MS);
    if (fresh) return previous;
    let got;
    try { got = await read(link); } catch { return previous; }
    const candidate = { repo: link.repo, number: link.number, url: link.url, state: got.state, checks: got.checks, headSha: got.headSha, checkedAt: now() };
    const pr = previous && prContent(previous) === prContent(candidate) ? previous : candidate;
    db.prepare('INSERT INTO issue_mirror_pr VALUES (?,?,?,?,?) ON CONFLICT(issue_id) DO UPDATE SET url=excluded.url, issue_updated_at=excluded.issue_updated_at, pr=excluded.pr, read_at=excluded.read_at')
      .run(issue.id, link.url, issue.updatedAt, JSON.stringify(pr), now());
    return pr;
  }

  /** Kanbanger nodes → TrackedIssues with PRs, read ≤ PR_CONCURRENCY at a time; input order kept. */
  async function build(nodes, force = false) {
    const work = nodes.map(node => ({ node, issue: trackedIssueOf(node, policy) })).filter(entry => entry.issue);
    const out = new Array(work.length);
    let next = 0;
    const lane = async () => {
      while (next < work.length) {
        const index = next++;
        const { node, issue } = work[index];
        out[index] = withPr(issue, await prFor(issue, prLinkOf(node, origin), force));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PR_CONCURRENCY, work.length) }, lane));
    // One issue can appear in two pages or passes: keep the newest copy.
    const byId = new Map();
    for (const issue of out) if (!byId.has(issue.id) || byId.get(issue.id).version < issue.version) byId.set(issue.id, issue);
    return [...byId.values()];
  }

  async function post(body) {
    const response = await send(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Edge unavailable'); }
    const result = await response.json();
    if (result?.accepted !== true) throw new Error('Edge did not accept the issues');
    return result;
  }

  /** Posts the issues whose version moved, ≤ MAX_ISSUES_PER_BATCH per request, then `complete` when given. */
  async function deliver(issues, complete) {
    const changed = issues.filter(issue => (sentRow(issue.id)?.version ?? -1) < issue.version);
    for (let i = 0; i < changed.length; i += MAX_ISSUES_PER_BATCH) {
      const chunk = changed.slice(i, i + MAX_ISSUES_PER_BATCH);
      await post({ contractVersion: '1', upserts: chunk });
      for (const issue of chunk) db.prepare('INSERT INTO issue_mirror_sent VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version, issue=excluded.issue').run(issue.id, issue.version, JSON.stringify(issue));
    }
    let removed = 0;
    if (complete) {
      const result = await post({ contractVersion: '1', upserts: [], complete: { ids: complete } });
      removed = Number.isSafeInteger(result.removed) ? result.removed : 0;
      const keep = new Set(complete);
      for (const { id } of db.prepare('SELECT id FROM issue_mirror_sent').all()) if (!keep.has(id)) {
        db.prepare('DELETE FROM issue_mirror_sent WHERE id=?').run(id);
        db.prepare('DELETE FROM issue_mirror_pr WHERE issue_id=?').run(id);
      }
    }
    return { sent: changed.length, removed };
  }

  const cursorOf = (nodes, from) => nodes.reduce((max, node) => Math.max(max, ms(node.updatedAt) ?? 0), from ?? 0);

  async function fullSync() {
    const since = new Date(now() - DONE_WINDOW_MS).toISOString();
    const open = await pages({ state: { type: { nin: ['completed', 'canceled'] } } });
    const done = await pages({ and: [{ state: { type: { in: ['completed', 'canceled'] } } }, { updatedAt: { gt: since } }] });
    const issues = await build([...open, ...done]);
    const result = await deliver(issues, issues.map(issue => issue.id));
    setMeta('cursor', cursorOf([...open, ...done], meta('cursor')));
    setMeta('full_at', now()); setMeta('incremental_at', now());
    return { kind: 'full', listed: issues.length, ...result };
  }

  async function incremental() {
    const cursor = meta('cursor') ?? 0;
    const nodes = await pages({ updatedAt: { gt: new Date(Math.max(0, cursor - MIRROR_OVERLAP_MS)).toISOString() } });
    // A Done/Canceled issue older than the window is not shown; the next full sync forgets it.
    const windowStart = now() - DONE_WINDOW_MS;
    const shown = nodes.filter(node => !['completed', 'canceled'].includes(node?.state?.type) || (ms(node.updatedAt) ?? 0) > windowStart);
    const issues = await build(shown);
    // Open PRs whose issue did not change: re-read the ones due, from the last copy sent.
    const seen = new Set(issues.map(issue => issue.id));
    const due = db.prepare("SELECT issue_id FROM issue_mirror_pr WHERE read_at < ? AND json_extract(pr, '$.state') = 'open' ORDER BY read_at LIMIT 100").all(now() - PR_REFRESH_MS)
      .map(row => row.issue_id).filter(id => !seen.has(id));
    const rechecked = [];
    for (const id of due) {
      const row = sentRow(id);
      if (!row) continue;
      const issue = JSON.parse(row.issue);
      if (!issue.pr) continue;
      rechecked.push(withPr(issue, await prFor(issue, { repo: issue.pr.repo, number: issue.pr.number, url: issue.pr.url }, true)));
    }
    const result = await deliver([...issues, ...rechecked]);
    setMeta('cursor', cursorOf(nodes, cursor)); setMeta('incremental_at', now());
    return { kind: 'incremental', listed: issues.length, rechecked: rechecked.length, ...result };
  }

  async function refreshQueued() {
    const ids = [...refreshQueue]; refreshQueue.clear();
    const nodes = [];
    for (const id of ids) {
      const node = await kanbanger.mirrorIssue(id);
      if (node) nodes.push(node);
    }
    return { kind: 'refresh', listed: nodes.length, ...(await deliver(await build(nodes, true))) };
  }

  return {
    /** One self-paced pass: queued refreshes always, then a full sync or an incremental pass when due. Throws on failure (the caller backs off). */
    async step() {
      const results = [];
      if (refreshQueue.size) results.push(await refreshQueued());
      const t = now();
      const fullAt = meta('full_at'), incrementalAt = meta('incremental_at');
      if (fullAt === null || t - fullAt >= fullSyncMs) results.push(await fullSync());
      else if (incrementalAt === null || t - incrementalAt >= intervalMs) results.push(await incremental());
      for (const r of results) if (r.sent || r.removed) log({ at: new Date(now()).toISOString(), step: 'issues', outcome: r.kind, listed: r.listed, sent: r.sent, removed: r.removed, ...(r.rechecked ? { rechecked: r.rechecked } : {}) });
      return results;
    },
    /** After an Arcade command changed an issue: re-read it on the next step, whatever the pacing. */
    refresh(issueId) { if (typeof issueId === 'string' && issueId) refreshQueue.add(issueId); },
    close() { db.close(); },
  };
}

/** edge.json `issues` block (BOB-99): {} or { intervalMs?, fullSyncMs?, dispatch?: { executionProfileId, repository? } }. Null when absent. */
export function parseIssuesConfig(issues) {
  if (issues === undefined) return null;
  const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRecord(issues) || Object.keys(issues).some(key => !['intervalMs', 'fullSyncMs', 'dispatch'].includes(key))) throw new Error('Edge issues must be an object with optional intervalMs, fullSyncMs, dispatch');
  if (issues.intervalMs !== undefined && (!Number.isInteger(issues.intervalMs) || issues.intervalMs < 5000 || issues.intervalMs > 600_000)) throw new Error('Edge issues.intervalMs must be 5000..600000');
  if (issues.fullSyncMs !== undefined && (!Number.isInteger(issues.fullSyncMs) || issues.fullSyncMs < 60_000 || issues.fullSyncMs > 86_400_000)) throw new Error('Edge issues.fullSyncMs must be 60000..86400000');
  let dispatch;
  if (issues.dispatch !== undefined) {
    const d = issues.dispatch;
    if (!isRecord(d) || Object.keys(d).some(key => !['executionProfileId', 'repository'].includes(key))) throw new Error('Edge issues.dispatch must be { executionProfileId, repository? }');
    if (typeof d.executionProfileId !== 'string' || !d.executionProfileId || d.executionProfileId.length > 200) throw new Error('Edge issues.dispatch.executionProfileId is required');
    if (d.repository !== undefined && (typeof d.repository !== 'string' || !/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(d.repository))) throw new Error('Edge issues.dispatch.repository must be owner/repo');
    dispatch = { executionProfileId: d.executionProfileId, ...(d.repository ? { repository: d.repository } : {}) };
  }
  return { intervalMs: issues.intervalMs ?? MIRROR_INTERVAL_MS, fullSyncMs: issues.fullSyncMs ?? MIRROR_FULL_SYNC_MS, ...(dispatch ? { dispatch } : {}) };
}
