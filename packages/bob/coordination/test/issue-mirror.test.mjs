import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../runtime/coordinator.mjs';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { dispatchBranch, edgeExporter, loadEdgeConfig, parseCommandInput, pickWorkflowState, RELAYED_OPERATIONS } from '../runtime/edge.mjs';
import { DONE_WINDOW_MS, forgejoPrReader, issueMirror, MAX_ISSUES_PER_BATCH, MIRROR_FULL_SYNC_MS, MIRROR_INTERVAL_MS, parseIssuesConfig, PR_REFRESH_MS, prLinkOf, trackedIssueOf } from '../runtime/issue-mirror.mjs';

const TOKEN = 't'.repeat(40), ENDPOINT = 'https://bob.test/api/sdlc/ingest', ISSUES_URL = 'https://bob.test/api/sdlc/issues';
const FORGEJO = { instanceUrl: 'https://git.forgegraf.com', token: 'forgejo-token' };
const T0 = Date.parse('2026-11-21T12:00:00Z');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEAM = { id: 'team-uuid', key: 'GMA' };
const BOB = { id: 'proj-bob', name: 'Bob' };
const policy = { workspaceId: 'gmacko', actorId: 'graham', targets: [], issueProjects: [{ integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'proj-bob' }] };

/** A Kanbanger issue node as listIssues returns it. */
const node = (n, overrides = {}) => ({
  id: uuid(n), identifier: `BOB-${n}`, title: `Issue ${n}`, url: `https://tasks.gmac.io/gmacko/issue/BOB-${n}`,
  updatedAt: new Date(T0 - 60_000).toISOString(), archivedAt: null, state: { name: 'In Progress', type: 'started' },
  team: TEAM, project: BOB, attachments: { nodes: [] }, ...overrides,
});

/** Fake Kanbanger: applies the filters the mirror builds, pages by `first`. */
function fakeKanbanger(nodes) {
  const matches = (n, f) => {
    if (!f) return true;
    if (f.and) return f.and.every(part => matches(n, part));
    if (f.state?.type?.nin) return !f.state.type.nin.includes(n.state.type);
    if (f.state?.type?.in) return f.state.type.in.includes(n.state.type);
    if (f.updatedAt?.gt) return Date.parse(n.updatedAt) > Date.parse(f.updatedAt.gt);
    throw new Error(`unexpected filter ${JSON.stringify(f)}`);
  };
  const k = {
    nodes, queries: 0,
    async listIssues(filter, after, first) {
      k.queries++;
      const all = k.nodes.filter(n => matches(n, filter));
      const start = after ? Number(after) : 0;
      return { nodes: all.slice(start, start + first), hasNextPage: start + first < all.length, endCursor: String(start + first) };
    },
    async mirrorIssue(id) { return k.nodes.find(n => n.id === id || n.identifier === id) ?? null; },
  };
  return k;
}

function mirrorFixture(t, { nodes = [], readPr, forgejo = FORGEJO, reply } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-mirror-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const posts = [];
  let clock = T0;
  const kanbanger = fakeKanbanger(nodes);
  const fetch = async (url, request) => {
    assert.equal(url, ISSUES_URL); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(request.body); posts.push(body);
    return Response.json(reply ? reply(body) : { accepted: true, stored: body.upserts.length, removed: 0 });
  };
  const logs = [];
  const mirror = issueMirror({ kanbanger, policy, endpoint: ENDPOINT, token: TOKEN, checkpoint: join(dir, 'edge.sqlite'), forgejo, readPr, fetch, now: () => clock, log: line => logs.push(line) });
  t.after(() => mirror.close());
  return { mirror, kanbanger, posts, logs, tick: ms => { clock += ms; }, get now() { return clock; } };
}

test('maps a Kanbanger node to a TrackedIssue: clipped title, https url only, dispatchable by policy', () => {
  const issue = trackedIssueOf(node(7, { title: 'x'.repeat(300) }), policy);
  assert.equal(issue.title.length, 160); assert.ok(issue.title.endsWith('…'));
  assert.deepEqual({ ...issue, title: undefined }, {
    id: uuid(7), key: 'BOB-7', title: undefined, url: 'https://tasks.gmac.io/gmacko/issue/BOB-7', state: { name: 'In Progress', type: 'started' },
    project: { id: 'proj-bob', name: 'Bob' }, team: 'GMA', updatedAt: T0 - 60_000, pr: null, dispatchable: true, version: T0 - 60_000,
  });
  assert.equal(trackedIssueOf(node(1, { url: 'http://tasks.gmac.io/x' }), policy).url, null);
  assert.equal(trackedIssueOf(node(1, { project: { id: 'other', name: 'Other' } }), policy).dispatchable, false);
  assert.equal(trackedIssueOf(node(1, { team: { id: 'team-uuid', key: 'ZZZ' } }), policy).dispatchable, false, 'team must match the policy too');
  assert.equal(trackedIssueOf(node(1, { team: { id: 'GMA', key: null } }), policy).dispatchable, true, 'team id may be the key in policy');
  assert.equal(trackedIssueOf(node(1, { archivedAt: new Date(T0).toISOString() }), policy), null);
  assert.equal(trackedIssueOf(node(1, { identifier: 'not a key' }), policy), null);
  assert.equal(trackedIssueOf(node(1, { state: { name: 'Odd', type: 'weird' } }), policy), null);
});

test('finds the first Forgejo PR attachment on this instance only', () => {
  const origin = 'https://git.forgegraf.com';
  const n = node(1, { attachments: { nodes: [{ url: 'https://github.com/gmackie/bob/pull/3' }, { url: 'https://git.forgegraf.com/gmackie/bob/issues/4' }, { url: 'https://git.forgegraf.com/gmackie/bob/pulls/324' }, { url: 'https://git.forgegraf.com/gmackie/bob/pulls/9' }] } });
  assert.deepEqual(prLinkOf(n, origin), { repo: 'gmackie/bob', number: 324, url: 'https://git.forgegraf.com/gmackie/bob/pulls/324' });
  assert.equal(prLinkOf(n, null), null);
  assert.equal(prLinkOf(node(2), origin), null);
});

test('the first step is a full sync: open issues plus Done/Canceled from the last 24 h, then complete ids', async t => {
  const nodes = [
    node(1), node(2, { state: { name: 'Todo', type: 'unstarted' } }), node(3, { state: { name: 'Backlog', type: 'backlog' } }),
    node(4, { state: { name: 'Done', type: 'completed' }, updatedAt: new Date(T0 - 3_600_000).toISOString() }),
    node(5, { state: { name: 'Done', type: 'completed' }, updatedAt: new Date(T0 - DONE_WINDOW_MS - 60_000).toISOString() }),
    node(6, { state: { name: 'Canceled', type: 'canceled' }, updatedAt: new Date(T0 - 60_000).toISOString() }),
  ];
  const f = mirrorFixture(t, { nodes, forgejo: null });
  const [result] = await f.mirror.step();
  assert.equal(result.kind, 'full');
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[0].upserts.map(i => i.key).sort(), ['BOB-1', 'BOB-2', 'BOB-3', 'BOB-4', 'BOB-6']);
  assert.deepEqual(f.posts[1].upserts, []);
  assert.deepEqual([...f.posts[1].complete.ids].sort(), [uuid(1), uuid(2), uuid(3), uuid(4), uuid(6)].sort());
  assert.ok(f.logs.every(line => !JSON.stringify(line).includes('Issue ')), 'titles never reach the log');
});

test(`posts at most ${MAX_ISSUES_PER_BATCH} issues per request`, async t => {
  const f = mirrorFixture(t, { nodes: Array.from({ length: 950 }, (_, i) => node(i + 1)), forgejo: null });
  await f.mirror.step();
  assert.deepEqual(f.posts.map(p => p.upserts.length), [400, 400, 150, 0]);
  assert.equal(f.posts[3].complete.ids.length, 950);
});

test('only issues whose version moved are sent again', async t => {
  const f = mirrorFixture(t, { nodes: [node(1), node(2)], forgejo: null });
  await f.mirror.step();
  f.posts.length = 0;
  f.tick(MIRROR_INTERVAL_MS);
  await f.mirror.step(); // incremental: both re-read in the overlap window, neither changed
  assert.deepEqual(f.posts, []);
  f.kanbanger.nodes[1] = node(2, { state: { name: 'In Review', type: 'started' }, updatedAt: new Date(f.now).toISOString() });
  f.tick(MIRROR_INTERVAL_MS);
  const [result] = await f.mirror.step();
  assert.equal(result.kind, 'incremental');
  assert.deepEqual(f.posts.map(p => p.upserts.map(i => [i.key, i.state.name])), [[['BOB-2', 'In Review']]]);
  f.posts.length = 0;
  f.tick(MIRROR_FULL_SYNC_MS);
  await f.mirror.step(); // full sync, nothing changed: just the complete list
  assert.deepEqual(f.posts.map(p => p.upserts.length), [0]);
});

test('a full sync drops issues Kanbanger no longer lists', async t => {
  const f = mirrorFixture(t, { nodes: [node(1), node(2)], forgejo: null });
  await f.mirror.step();
  f.kanbanger.nodes.pop();
  f.posts.length = 0;
  f.tick(MIRROR_FULL_SYNC_MS);
  await f.mirror.step();
  assert.deepEqual(f.posts.at(-1).complete.ids, [uuid(1)]);
  // Gone from the sent table: if it comes back it is sent again.
  f.kanbanger.nodes.push(node(2));
  f.posts.length = 0;
  f.tick(MIRROR_FULL_SYNC_MS);
  await f.mirror.step();
  assert.deepEqual(f.posts[0].upserts.map(i => i.key), ['BOB-2']);
});

test('PR join: open (pending, success, failure, no statuses), merged; a failed read keeps the cached PR', async t => {
  const pr = n => ({ attachments: { nodes: [{ url: `https://git.forgegraf.com/gmackie/bob/pulls/${n}` }] } });
  const answers = { 11: { state: 'open', checks: 'pending', headSha: 'a'.repeat(40) }, 12: { state: 'open', checks: 'success', headSha: 'b'.repeat(40) }, 13: { state: 'open', checks: 'failure', headSha: 'c'.repeat(40) }, 14: { state: 'open', checks: null, headSha: 'd'.repeat(40) }, 15: { state: 'merged', checks: null, headSha: 'e'.repeat(40) } };
  let down = false;
  const reads = [];
  const readPr = async link => { reads.push(link.number); if (down) throw new Error('Forgejo down'); return answers[link.number]; };
  const f = mirrorFixture(t, { nodes: [11, 12, 13, 14, 15].map(n => node(n, pr(n))), readPr });
  await f.mirror.step();
  const sent = Object.fromEntries(f.posts[0].upserts.map(i => [i.key, i.pr]));
  assert.deepEqual(Object.fromEntries(Object.entries(sent).map(([k, p]) => [k, [p.state, p.checks]])), { 'BOB-11': ['open', 'pending'], 'BOB-12': ['open', 'success'], 'BOB-13': ['open', 'failure'], 'BOB-14': ['open', null], 'BOB-15': ['merged', null] });
  assert.deepEqual(sent['BOB-12'], { repo: 'gmackie/bob', number: 12, url: 'https://git.forgegraf.com/gmackie/bob/pulls/12', state: 'open', checks: 'success', headSha: 'b'.repeat(40), checkedAt: T0 });
  assert.equal(f.posts[0].upserts.find(i => i.key === 'BOB-12').version, T0, 'version = max(updatedAt, pr.checkedAt)');
  // Within 5 min nothing is re-read; after, open PRs are (merged ones are final).
  reads.length = 0; f.posts.length = 0;
  f.tick(MIRROR_INTERVAL_MS); await f.mirror.step();
  assert.deepEqual(reads, []);
  answers[11] = { state: 'open', checks: 'success', headSha: 'a'.repeat(40) };
  f.tick(PR_REFRESH_MS); await f.mirror.step();
  assert.deepEqual(reads.sort(), [11, 12, 13, 14]);
  assert.deepEqual(f.posts.flatMap(p => p.upserts).map(i => [i.key, i.pr.checks]), [['BOB-11', 'success']], 'only the PR that changed is sent');
  // Forgejo down: the cached PR stays, nothing is lost or sent.
  down = true; f.posts.length = 0;
  f.tick(PR_REFRESH_MS); await f.mirror.step(); // a full sync is due by now: it lists every issue, sends none
  assert.deepEqual(f.posts.flatMap(p => p.upserts), []);
  f.posts.length = 0;
  f.kanbanger.nodes[0] = node(11, { ...pr(11), updatedAt: new Date(f.now).toISOString() });
  f.tick(MIRROR_INTERVAL_MS); await f.mirror.step();
  assert.deepEqual(f.posts.flatMap(p => p.upserts).map(i => [i.key, i.pr.checks]), [['BOB-11', 'success']], 'a changed issue keeps its cached PR while Forgejo is down');
});

test('without Forgejo configured, pr stays null and the mirror still runs', async t => {
  const f = mirrorFixture(t, { nodes: [node(1, { attachments: { nodes: [{ url: 'https://git.forgegraf.com/gmackie/bob/pulls/1' }] } })], forgejo: null });
  await f.mirror.step();
  assert.equal(f.posts[0].upserts[0].pr, null);
});

test('forgejoPrReader maps PR state and the combined status of the head', async t => {
  const responses = {
    '/api/v1/repos/gmackie/bob/pulls/1': { state: 'open', merged: false, head: { sha: 'a'.repeat(40) } },
    [`/api/v1/repos/gmackie/bob/commits/${'a'.repeat(40)}/status`]: { state: 'error', statuses: [{}] },
    '/api/v1/repos/gmackie/bob/pulls/2': { state: 'closed', merged: true, head: { sha: 'b'.repeat(40) } },
    '/api/v1/repos/gmackie/bob/pulls/3': { state: 'open', merged: false, head: { sha: 'c'.repeat(40) } },
    [`/api/v1/repos/gmackie/bob/commits/${'c'.repeat(40)}/status`]: { state: 'pending', statuses: [] },
  };
  const seen = [];
  const fetch = async (url, request) => {
    const path = new URL(url).pathname; seen.push(path);
    assert.equal(request.headers.authorization, 'token forgejo-token');
    return path in responses ? Response.json(responses[path]) : new Response('no', { status: 404 });
  };
  const read = forgejoPrReader({ ...FORGEJO, fetch });
  assert.deepEqual(await read({ repo: 'gmackie/bob', number: 1 }), { state: 'open', checks: 'failure', headSha: 'a'.repeat(40) });
  assert.deepEqual(await read({ repo: 'gmackie/bob', number: 2 }), { state: 'merged', checks: null, headSha: 'b'.repeat(40) });
  assert.deepEqual(await read({ repo: 'gmackie/bob', number: 3 }), { state: 'open', checks: null, headSha: 'c'.repeat(40) });
  await assert.rejects(read({ repo: 'gmackie/bob', number: 4 }), /404/);
  assert.ok(!seen.includes(`/api/v1/repos/gmackie/bob/commits/${'b'.repeat(40)}/status`), 'a merged PR needs no status read');
});

test('refresh(issueId) re-reads that issue on the next step whatever the pacing', async t => {
  const f = mirrorFixture(t, { nodes: [node(1), node(2)], forgejo: null });
  await f.mirror.step();
  f.posts.length = 0;
  f.kanbanger.nodes[0] = node(1, { state: { name: 'Done', type: 'completed' }, updatedAt: new Date(f.now + 1).toISOString() });
  f.mirror.refresh(uuid(1));
  const results = await f.mirror.step();
  assert.deepEqual(results.map(r => r.kind), ['refresh']);
  assert.deepEqual(f.posts.map(p => p.upserts.map(i => [i.key, i.state.type])), [[['BOB-1', 'completed']]]);
});

test('a refused post throws and is retried: nothing is marked sent', async t => {
  let ok = false;
  const f = mirrorFixture(t, { nodes: [node(1)], forgejo: null, reply: body => (ok ? { accepted: true, stored: body.upserts.length, removed: 0 } : { accepted: false }) });
  await assert.rejects(f.mirror.step(), /did not accept/);
  ok = true;
  await f.mirror.step();
  assert.deepEqual(f.posts.at(-2).upserts.map(i => i.key), ['BOB-1']);
});

test('the mirror refuses an endpoint or token it should not post to', t => {
  const base = { kanbanger: fakeKanbanger([]), policy, token: TOKEN, checkpoint: join(tmpdir(), 'unused.sqlite') };
  assert.throws(() => issueMirror({ ...base, endpoint: 'http://bob.test/api/sdlc/ingest' }));
  assert.throws(() => issueMirror({ ...base, endpoint: 'https://bob.test/api/sdlc/other' }));
  assert.throws(() => issueMirror({ ...base, endpoint: ENDPOINT, token: 'short' }));
});

test('edge.json issues block: optional, strict, with an optional dispatch profile', t => {
  assert.equal(parseIssuesConfig(undefined), null);
  assert.deepEqual(parseIssuesConfig({}), { intervalMs: MIRROR_INTERVAL_MS, fullSyncMs: MIRROR_FULL_SYNC_MS });
  assert.deepEqual(parseIssuesConfig({ intervalMs: 60_000, fullSyncMs: 900_000, dispatch: { executionProfileId: 'bob-claude', repository: 'gmackie/bob' } }), { intervalMs: 60_000, fullSyncMs: 900_000, dispatch: { executionProfileId: 'bob-claude', repository: 'gmackie/bob' } });
  for (const bad of [true, { intervalMs: 100 }, { fullSyncMs: 1000 }, { extra: 1 }, { dispatch: {} }, { dispatch: { executionProfileId: 'x', repository: 'not a repo' } }, { dispatch: { executionProfileId: 'x', other: 1 } }]) assert.throws(() => parseIssuesConfig(bad), JSON.stringify(bad));
  const dir = mkdtempSync(join(tmpdir(), 'bob-issues-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = config => { const path = join(dir, 'edge.json'); writeFileSync(path, JSON.stringify({ endpoint: ENDPOINT, checkpoint: join(dir, 'edge.sqlite'), tokenEnv: 'EDGE_TOKEN', ...config })); return path; };
  assert.equal(loadEdgeConfig(write({}), { EDGE_TOKEN: TOKEN }).issues, undefined);
  assert.deepEqual(loadEdgeConfig(write({ issues: {} }), { EDGE_TOKEN: TOKEN }).issues, { intervalMs: MIRROR_INTERVAL_MS, fullSyncMs: MIRROR_FULL_SYNC_MS });
  assert.deepEqual(loadEdgeConfig(write({ commands: { operations: ['SetIssueState', 'DispatchIssue'] } }), { EDGE_TOKEN: TOKEN }).commands, { operations: ['SetIssueState', 'DispatchIssue'] });
  assert.throws(() => loadEdgeConfig(write({ issues: { intervalMs: 1 } }), { EDGE_TOKEN: TOKEN }));
});

test('SetIssueState and DispatchIssue inputs are validated like commands.ts', () => {
  assert.ok(RELAYED_OPERATIONS.includes('SetIssueState') && RELAYED_OPERATIONS.includes('DispatchIssue'));
  assert.deepEqual(parseCommandInput('SetIssueState', { issueId: uuid(1), target: 'in_review', junk: 1 }), { issueId: uuid(1), target: 'in_review' });
  assert.deepEqual(parseCommandInput('DispatchIssue', { issueId: uuid(1) }), { issueId: uuid(1) });
  for (const [op, input] of [['SetIssueState', { issueId: 'BOB-1', target: 'done' }], ['SetIssueState', { issueId: uuid(1), target: 'shipped' }], ['DispatchIssue', { issueId: 'nope' }], ['DispatchIssue', null]]) assert.equal(parseCommandInput(op, input), null);
});

test('pickWorkflowState: by name first, else by type and position', () => {
  const states = [
    { id: 's-done', name: 'Done', type: 'completed', position: 4 }, { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
    { id: 's-prog', name: 'In Progress', type: 'started', position: 2 }, { id: 's-rev', name: 'In Review', type: 'started', position: 3 },
    { id: 's-cxl', name: 'Cancelled', type: 'canceled', position: 5 },
  ];
  assert.deepEqual(['todo', 'in_progress', 'in_review', 'done', 'canceled'].map(t => pickWorkflowState(states, t).id), ['s-todo', 's-prog', 's-rev', 's-done', 's-cxl']);
  const odd = [{ id: 'a', name: 'Ready', type: 'unstarted', position: 2 }, { id: 'b', name: 'Doing', type: 'started', position: 3 }, { id: 'c', name: 'Code review', type: 'started', position: 4 }, { id: 'd', name: 'Shipped', type: 'completed', position: 5 }];
  assert.deepEqual(['todo', 'in_progress', 'in_review', 'done', 'canceled'].map(t => pickWorkflowState(odd, t)?.id ?? null), ['a', 'b', 'c', 'd', null]);
  assert.equal(dispatchBranch('BOB-12', 'Fix: the floor — again!'), 'bob/BOB-12-fix-the-floor-again');
  assert.equal(dispatchBranch('BOB-12', ''), 'bob/BOB-12');
});

// ── Commands through the exporter ───────────────────────────────────────────

const target = { environmentId: 'hetzner-bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'gmackie/bob' } };
const execContext = { ...policy, targets: [target] };

function exporterFixture(t, { Klass = Coordinator, context = execContext } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-issue-cmd-'));
  const coordinator = new Klass({ database: join(dir, 'coordination.sqlite'), context });
  t.after(() => { coordinator.close(); rmSync(dir, { recursive: true, force: true }); });
  const batches = [];
  let commands = [];
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body); batches.push(body);
    const answer = { accepted: true, watermark: body.watermark, commands }; commands = [];
    return Response.json(answer);
  };
  return {
    coordinator, batches, dir, queue: list => { commands = list; },
    options: { coordinator, endpoint: ENDPOINT, token: TOKEN, checkpoint: join(dir, 'edge.sqlite'), fetch, now: () => T0, log: () => {} },
    results: () => Object.fromEntries(batches.flatMap(b => b.results ?? []).map(r => [r.commandId, r])),
  };
}

function fakeIssueKanbanger({ stateId = 's-prog', fail } = {}) {
  const calls = [];
  const issue = { id: uuid(1), identifier: 'BOB-1', title: 'Fix the floor', url: 'https://tasks.gmac.io/gmacko/issue/BOB-1', state: { id: stateId, name: 'In Progress', type: 'started' }, team: { id: 'team-uuid', key: 'GMA', name: 'GMA' }, project: { id: 'proj-bob', name: 'Bob' } };
  const k = {
    calls,
    async resolveIssue(id) { calls.push(['resolve', id]); if (fail) throw fail; return issue; },
    async workflowStates(teamId) { calls.push(['states', teamId]); return [{ id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 }, { id: 's-prog', name: 'In Progress', type: 'started', position: 2 }, { id: 's-rev', name: 'In Review', type: 'started', position: 3 }, { id: 's-done', name: 'Done', type: 'completed', position: 4 }]; },
    async updateIssueState(id, stateId) { calls.push(['update', id, stateId]); issue.state = { id: stateId }; return issue; },
    async createComment(id, body) { calls.push(['comment', id, body]); return { id: 'c1' }; },
    async mirrorIssue(id) { calls.push(['mirror', id]); return { ...node(1, { title: 'Fix the floor', team: TEAM, project: BOB }), id }; },
    async issueDescription(id) { calls.push(['description', id]); return 'Collapse empty stations.'; },
  };
  return k;
}

const command = (commandId, operation, input) => ({ commandId, actor: 'bob-user-1', queuedAt: 1, operation, input });

test('SetIssueState moves the issue, comments without user ids, refreshes the mirror and reports a synthesized operation', async t => {
  const f = exporterFixture(t);
  const kanbanger = fakeIssueKanbanger();
  const refreshed = [];
  const exporter = edgeExporter({ ...f.options, commands: { operations: ['SetIssueState'] }, issues: { kanbanger, mirror: { refresh: id => refreshed.push(id) } } }); t.after(() => exporter.close());
  f.queue([command('set-1', 'SetIssueState', { issueId: uuid(1), target: 'in_review' }), command('set-2', 'SetIssueState', { issueId: uuid(1), target: 'in_review' })]);
  await exporter.flush(); await exporter.flush();
  assert.deepEqual(kanbanger.calls.filter(c => c[0] === 'update' || c[0] === 'comment'), [['update', uuid(1), 's-rev'], ['comment', uuid(1), 'Moved to In Review from the Bob Arcade.']], 'the second command finds it already there: no second write');
  assert.deepEqual(refreshed, [uuid(1), uuid(1)]);
  const r = f.results()['set-1'];
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.operation, operationId: 'x' }, { contractVersion: '1', operationId: 'x', commandId: 'set-1', state: 'succeeded', resourceId: uuid(1), resourceVersion: 0 });
  assert.ok(!JSON.stringify(kanbanger.calls).includes('bob-user-1'), 'no user id reaches Kanbanger');
});

test('SetIssueState: a Kanbanger refusal is final, an outage is retried, and no issues block means NotSupported', async t => {
  const refused = Object.assign(new Error('Kanbanger rejected the request (HTTP 400)'), { code: 'KanbangerRejected', status: 502, retryable: false });
  const down = Object.assign(new Error('Kanbanger is unavailable (HTTP 503)'), { code: 'KanbangerUnavailable', status: 503, retryable: true });
  const f = exporterFixture(t);
  const ex1 = edgeExporter({ ...f.options, commands: { operations: ['SetIssueState'] }, issues: { kanbanger: fakeIssueKanbanger({ fail: refused }) } }); t.after(() => ex1.close());
  f.queue([command('set-refused', 'SetIssueState', { issueId: uuid(1), target: 'done' })]);
  await ex1.flush(); await ex1.flush();
  assert.deepEqual([f.results()['set-refused'].ok, f.results()['set-refused'].error.code], [false, 'KanbangerRejected']);

  const g = exporterFixture(t);
  const ex2 = edgeExporter({ ...g.options, commands: { operations: ['SetIssueState'] }, issues: { kanbanger: fakeIssueKanbanger({ fail: down }) } }); t.after(() => ex2.close());
  g.queue([command('set-down', 'SetIssueState', { issueId: uuid(1), target: 'done' })]);
  await ex2.flush(); await ex2.flush();
  assert.equal(g.results()['set-down'], undefined, 'transient: no result, the edge re-sends it');

  const h = exporterFixture(t);
  const ex3 = edgeExporter({ ...h.options, commands: { operations: ['SetIssueState'] } }); t.after(() => ex3.close());
  h.queue([command('set-none', 'SetIssueState', { issueId: uuid(1), target: 'done' })]);
  await ex3.flush(); await ex3.flush();
  assert.equal(h.results()['set-none'].error.code, 'NotSupported');
});

test('DispatchIssue creates a one-item plan, starts it and requests the execution, idempotently', async t => {
  const f = exporterFixture(t, { Klass: ExecutionCoordinator });
  const kanbanger = fakeIssueKanbanger();
  const forge = { defaultBranch: async repo => { assert.equal(repo, 'gmackie/bob'); return 'master'; }, branchHead: async (repo, branch) => { assert.equal(branch, 'master'); return 'f'.repeat(40); } };
  const refreshed = [];
  const exporter = edgeExporter({ ...f.options, commands: { operations: ['DispatchIssue'], coordinator: f.coordinator }, issues: { kanbanger, mirror: { refresh: id => refreshed.push(id) }, dispatch: { executionProfileId: 'bob-claude' }, forge } }); t.after(() => exporter.close());
  f.queue([command('dispatch-1', 'DispatchIssue', { issueId: uuid(1) })]);
  await exporter.flush(); await exporter.flush();
  // Delivered again (the edge re-sends until it sees a result): a replay, not a second plan.
  f.queue([command('dispatch-1', 'DispatchIssue', { issueId: uuid(1) })]);
  await exporter.flush(); await exporter.flush();
  const result = f.results()['dispatch-1'];
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.operation.state, 'accepted');
  const plans = f.coordinator.db.prepare('SELECT id, definition, state FROM coordination_plan').all();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].state, 'active');
  const [item] = JSON.parse(plans[0].definition).items;
  assert.match(item.itemId, /^issue-BOB-1-[a-f0-9]{12}$/);
  assert.deepEqual(item.issue, { integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'proj-bob', issueId: uuid(1), identifier: 'BOB-1' });
  assert.equal(item.completionTarget, 'production');
  const attempt = JSON.parse(f.coordinator.db.prepare('SELECT request FROM coordination_attempt').get().request);
  assert.deepEqual({ branch: attempt.workspace.branch, base: attempt.workspace.baseRevision, profile: attempt.executionProfileId, title: attempt.work.title, instructions: attempt.work.instructions },
    { branch: 'bob/BOB-1-fix-the-floor', base: 'f'.repeat(40), profile: 'bob-claude', title: 'BOB-1: Fix the floor', instructions: 'Collapse empty stations.' });
  assert.equal(f.coordinator.db.prepare('SELECT COUNT(*) AS n FROM coordination_attempt').get().n, 1);
  assert.ok(refreshed.includes(uuid(1)));
});

test('DispatchIssue refuses without a dispatch profile, outside the policy, or for a closed issue', async t => {
  const f = exporterFixture(t, { Klass: ExecutionCoordinator });
  const forge = { defaultBranch: async () => 'master', branchHead: async () => 'f'.repeat(40) };
  const outside = fakeIssueKanbanger();
  outside.mirrorIssue = async id => ({ ...node(1, { project: { id: 'proj-other', name: 'Other' } }), id });
  const closed = fakeIssueKanbanger();
  closed.mirrorIssue = async id => ({ ...node(1, { state: { name: 'Done', type: 'completed' } }), id });
  const cases = [
    ['no-profile', { kanbanger: fakeIssueKanbanger(), forge }, 'NotSupported'],
    ['no-forge', { kanbanger: fakeIssueKanbanger(), dispatch: { executionProfileId: 'p' } }, 'NotSupported'],
    ['outside', { kanbanger: outside, dispatch: { executionProfileId: 'p' }, forge }, 'Forbidden'],
    ['closed', { kanbanger: closed, dispatch: { executionProfileId: 'p' }, forge }, 'InvalidTransition'],
  ];
  for (const [id, issues, code] of cases) {
    const exporter = edgeExporter({ ...f.options, checkpoint: join(f.dir, `${id}.sqlite`), commands: { operations: ['DispatchIssue'], coordinator: f.coordinator }, issues });
    f.queue([command(id, 'DispatchIssue', { issueId: uuid(1) })]);
    await exporter.flush(); await exporter.flush();
    exporter.close();
    assert.equal(f.results()[id]?.error?.code, code, id);
  }
  assert.equal(f.coordinator.db.prepare('SELECT COUNT(*) AS n FROM coordination_plan').get().n, 0);
});
