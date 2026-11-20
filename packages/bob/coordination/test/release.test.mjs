import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionCoordinator } from '../runtime/execution.mjs';
import { outputValidators } from '../runtime/coordinator.mjs';
import { advanceReleases, itemStateFor, repoSlug, releaseTimings, pullRequestTitle } from '../runtime/release.mjs';
import { forgePort } from '../runtime/forge-port.mjs';
import { deliverIssueEffect, releaseCommentFor } from '../runtime/issue-effects.mjs';

const target = { environmentId: 'bob', projectId: 'bob', repository: { integrationId: 'forgegraph', repositoryId: 'bob' } };
const project = { integrationId: 'kanbanger', workspaceId: 'workspace', teamId: 'GMA', projectId: 'bob' };
const baseContext = { workspaceId: 'workspace', actorId: 'actor', targets: [target], issueProjects: [project], receiptEnvironmentId: 'bob', release: { autoMergeDefault: true, repositories: { bob: 'gmackie/bob' } } };
const item = (itemId = 'item-1', completionTarget = 'production') => ({ itemId, issue: { ...project, issueId: itemId, identifier: 'BOB-' + itemId.split('-')[1] }, issueSnapshotRef: 'snapshot', target, completionTarget });
const query = resourceId => ({ contractVersion: '1', resourceId });
const call = (c, name, body, options = {}) => c.call(name, body, { idempotencyKey: body.commandId ?? body.requestId, ...options });
const code = expected => error => error.code === expected;
const sha = c => c.repeat(40);
const T0 = Date.parse('2026-11-15T12:00:00Z');

function setup(t, { items = [item()], dependencies = [], autoMerge, context = baseContext } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bob-release-')), database = join(dir, 'store.sqlite');
  const service = new ExecutionCoordinator({ database, context });
  const plan = call(service, 'CreatePlan', { contractVersion: '1', commandId: 'create', plan: { items, dependencies, concurrencyLimit: 4, ...(autoMerge === undefined ? {} : { autoMerge }) } });
  call(service, 'ControlPlan', { contractVersion: '1', commandId: 'start', planId: plan.resourceId, expectedVersion: 1, action: 'start' });
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  return { service, planId: plan.resourceId };
}
const request = (f, suffix = '1', itemId = 'item-1') => ({ contractVersion: '1', requestId: 'request-' + suffix, attemptId: 'attempt-' + suffix, itemId, planId: f.planId, planVersion: 2, issueSnapshotRef: 'snapshot', target, work: { title: 'Task ' + suffix, instructions: 'Do work', acceptanceCriteria: ['Check result'] }, workspace: { baseRevision: sha('a'), branch: 'bob/BOB-1-task' }, executionProfileId: 'pistache' });
const admission = r => ({ contractVersion: '1', requestId: r.requestId, executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, target: r.target, thread: { environmentId: 'bob', projectId: 'bob', threadId: 'thread-' + r.attemptId } });
const port = { requireCapabilities: async () => {}, submit: async r => admission(r), find: async () => null };
const receipt = (r, extra = {}) => ({ contractVersion: '1', eventId: 'event-' + r.attemptId, environmentId: 'bob', executionId: 'execution-' + r.attemptId, attemptId: r.attemptId, sequence: 1, occurredAt: '2026-11-15T12:00:00Z', outcome: 'succeeded', thread: admission(r).thread, sourceSnapshot: { repository: target.repository, commitSha: sha('b'), treeDigest: 'c'.repeat(64), dirty: false }, evidenceRefs: ['execution-log'], ...extra });
const published = (head = sha('d'), number = 7) => ({ publishedHead: { branch: 'bob/BOB-1-task', commitSha: head, pullRequest: { repository: target.repository, number, url: `https://git.forgegraf.com/gmackie/bob/pulls/${number}` } } });

/** Runs item through execution and records a succeeded receipt. */
async function succeed(f, { suffix = '1', itemId = 'item-1', extra = published() } = {}) {
  const r = request(f, suffix, itemId);
  call(f.service, 'RequestExecution', r);
  await f.service.dispatchOne(port);
  call(f.service, 'RecordExecutionReceipt', receipt(r, extra));
  return r;
}
const getItem = (f, id = 'item-1') => {
  const value = f.service.call('GetItem', query(id));
  assert(outputValidators.get('GetItem')(value), JSON.stringify(outputValidators.get('GetItem').errors));
  return value.item;
};

/** An in-memory Forgejo + ForgeGraph. */
function fakeForge(overrides = {}) {
  const state = {
    branches: { 'bob/BOB-1-task': sha('d') },
    prs: { 7: { state: 'open', merged: false, mergeSha: null, headSha: sha('d'), mergeable: true } },
    statuses: { [sha('d')]: { state: 'success', total: 3 } },
    app: 'blder-bot',
    deployments: [],
    health: 'healthy',
    ancestors: {},
    calls: [],
  };
  const forge = {
    state,
    async branchHead(repo, branch) { state.calls.push(['branchHead', repo, branch]); return state.branches[branch] ?? null; },
    async defaultBranch() { return 'master'; },
    async findPullRequest(repo, branch) { state.calls.push(['findPullRequest', branch]); return Object.entries(state.prs).find(([, pr]) => pr.branch === branch && pr.state === 'open')?.[0] ? { number: 9 } : null; },
    async openPullRequest(repo, body) { state.calls.push(['openPullRequest', body]); state.prs[9] = { state: 'open', merged: false, mergeSha: null, headSha: state.branches[body.head], mergeable: true, branch: body.head }; return { number: 9, url: 'https://git.forgegraf.com/gmackie/bob/pulls/9' }; },
    async pullRequest(repo, number) { return { ...state.prs[number] }; },
    async closePullRequest(repo, number, comment) { state.calls.push(['closePullRequest', number, comment]); state.prs[number].state = 'closed'; },
    async combinedStatus(repo, head) { return state.statuses[head] ?? { state: 'none', total: 0 }; },
    async approve(repo, number, head) { state.calls.push(['approve', number, head]); return { approved: true }; },
    async merge(repo, number, head) {
      state.calls.push(['merge', number, head]);
      const pr = state.prs[number];
      if (pr.headSha !== head) return { merged: false, reason: 'head moved' };
      Object.assign(pr, { merged: true, state: 'closed', mergeSha: sha('e') });
      return { merged: true, mergeSha: sha('e') };
    },
    async forgegraphApp() { return state.app; },
    async containsCommit(repo, head, wanted) { return (state.ancestors[head] ?? []).includes(wanted); },
    async deployments() { return state.deployments; },
    async health() { return state.health; },
    async rollback(id) { state.calls.push(['rollback', id]); },
    ...overrides,
  };
  return forge;
}
let clock = T0;
/** One driver pass; without an explicit time the clock moves 1 s, so rows due at now + 1 run next. */
const pass = (f, forge, now) => advanceReleases(f.service, forge, { now: now ?? (clock += 1000) });

test('a published, green run is approved, merged, deployed and verified, writing milestones as it goes', async t => {
  const f = setup(t), forge = fakeForge();
  await succeed(f);
  let snapshot = getItem(f);
  assert.equal(snapshot.state, 'validating');
  assert.equal(snapshot.release.stage, 'awaiting-publish');
  assert.equal(snapshot.release.autoMerge, true);
  assert.equal(snapshot.release.headSha, sha('d'));
  assert(snapshot.evidenceRefs.includes(`commit:${sha('d')}`), 'the pushed head replaces the hidden checkpoint for CI detail');

  await pass(f, forge);                         // awaiting-publish → checks-running
  assert.equal(getItem(f).release.stage, 'checks-running');
  await pass(f, forge);                         // checks green → review-ready
  snapshot = getItem(f);
  assert.equal(snapshot.state, 'review');
  assert.deepEqual(snapshot.achievedMilestones, ['execution-succeeded', 'review-ready']);
  await pass(f, forge);                         // autoMerge: approve + merge
  snapshot = getItem(f);
  assert.deepEqual(forge.state.calls.filter(c => ['approve', 'merge'].includes(c[0])).map(c => c[0]), ['approve', 'merge']);
  assert.equal(snapshot.release.mergeSha, sha('e'));
  assert.equal(snapshot.release.approvedSha, sha('d'));
  await pass(f, forge);                         // merged → deploying (app resolved)
  snapshot = getItem(f);
  assert.equal(snapshot.state, 'deploying');
  assert.equal(snapshot.release.appSlug, 'blder-bot');
  assert.deepEqual(snapshot.achievedMilestones, ['execution-succeeded', 'review-ready', 'merged']);

  await pass(f, forge, T0 + 60_000);            // nothing deployed yet
  assert.equal(getItem(f).release.stage, 'deploying');
  forge.state.deployments = [{ id: 'dep-1', status: 'active', historyStatus: 'active', commitSha: sha('f'), createdAt: '2026-11-15T12:05:00Z', storePath: null, versionId: 'v1' }];
  forge.state.ancestors[sha('f')] = [sha('f'), sha('e')];
  await pass(f, forge, T0 + 120_000);
  snapshot = getItem(f);
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.release.stage, 'production-verified');
  assert.equal(snapshot.release.deploymentId, 'dep-1');
  assert.deepEqual(snapshot.achievedMilestones, ['execution-succeeded', 'review-ready', 'merged', 'production-verified']);
  const facts = f.service.db.prepare('SELECT fact FROM coordination_issue_effect ORDER BY rowid').all().map(r => r.fact);
  assert.deepEqual(facts, ['admitted', 'execution-succeeded', 'pr-open', 'review-ready', 'merged', 'production-verified']);
  // Nothing more to do: a further pass claims nothing.
  assert.equal((await pass(f, forge, T0 + 10 * 60_000)).processed, 0);
});

test('without autoMerge a review-ready item waits for a RequestRelease merge at the exact head', async t => {
  const f = setup(t, { autoMerge: false }), forge = fakeForge();
  await succeed(f);
  await pass(f, forge); await pass(f, forge); await pass(f, forge);
  let snapshot = getItem(f);
  assert.equal(snapshot.state, 'review');
  assert.equal(snapshot.release.autoMerge, false);
  assert.equal(forge.state.calls.some(c => c[0] === 'merge'), false);
  const body = { contractVersion: '1', commandId: 'merge-1', attemptId: 'attempt-1', action: 'merge', sourceRevision: sha('d'), pullRequestRef: '7' };
  assert.throws(() => call(f.service, 'RequestRelease', { ...body, commandId: 'merge-stale', sourceRevision: sha('9') }), code('RevisionConflict'));
  assert.throws(() => call(f.service, 'RequestRelease', body, { expectItemId: 'item-2' }), code('InvalidTransition'));
  const op = call(f.service, 'RequestRelease', body, { actor: 'bob-user-1' });
  assert.equal(op.state, 'accepted');
  assert.deepEqual(call(f.service, 'RequestRelease', body, { actor: 'bob-user-1' }), op, 'replay returns the original operation');
  assert.throws(() => call(f.service, 'RequestRelease', { ...body, commandId: 'merge-2' }), code('InvalidTransition'));
  await pass(f, forge);
  snapshot = getItem(f);
  assert.equal(snapshot.state, 'deploying');
  assert.equal(f.service.call('GetOperation', query(op.operationId)).state, 'succeeded');
  const log = f.service.db.prepare("SELECT outcome, actor FROM coordination_command_log WHERE command_id='merge-1' ORDER BY rowid").all();
  assert.deepEqual(log.map(r => [r.outcome, r.actor]), [['InvalidTransition', null], ['accepted', 'bob-user-1'], ['succeeded', 'bob-user-1']]);
});

test('red CI fails the item; a retry starts a fresh attempt and retires the old release', async t => {
  const f = setup(t), forge = fakeForge();
  forge.state.statuses[sha('d')] = { state: 'failure', total: 2 };
  await succeed(f);
  await pass(f, forge); await pass(f, forge);
  let snapshot = getItem(f);
  assert.equal(snapshot.state, 'failed');
  assert.equal(snapshot.release.stage, 'checks-failed');
  assert.match(snapshot.release.note, /CI failed/);
  assert.equal(forge.state.calls.some(c => c[0] === 'merge'), false);
  call(f.service, 'RetryItem', { contractVersion: '1', commandId: 'retry', itemId: 'item-1', expectedVersion: snapshot.resourceVersion, previousAttemptId: 'attempt-1', reason: 'fix CI' });
  snapshot = getItem(f);
  assert.equal(snapshot.state, 'reserved');
  assert.equal(snapshot.release, null);
});

test('a moved head goes back to checks and a stale merge request fails', async t => {
  const f = setup(t, { autoMerge: false }), forge = fakeForge();
  await succeed(f);
  await pass(f, forge); await pass(f, forge);
  const op = call(f.service, 'RequestRelease', { contractVersion: '1', commandId: 'merge-1', attemptId: 'attempt-1', action: 'merge', sourceRevision: sha('d') });
  forge.state.prs[7].headSha = sha('8');
  await pass(f, forge);
  const snapshot = getItem(f);
  assert.equal(snapshot.state, 'validating');
  assert.equal(snapshot.release.stage, 'checks-running');
  assert.equal(snapshot.release.headSha, sha('8'));
  const failed = f.service.call('GetOperation', query(op.operationId));
  assert.equal(failed.state, 'failed'); assert.equal(failed.error.code, 'RevisionConflict');
  assert.equal(forge.state.calls.some(c => c[0] === 'merge'), false);
});

test('without publishedHead the branch is read from Forgejo and a PR is opened; nothing published blocks', async t => {
  const f = setup(t, { items: [item('item-1'), item('item-2')] }), forge = fakeForge();
  await succeed(f, { extra: {} });
  await pass(f, forge);
  let snapshot = getItem(f);
  assert.equal(snapshot.release.stage, 'checks-running');
  assert.equal(snapshot.release.pullRequest.number, 9);
  assert.deepEqual(forge.state.calls.find(c => c[0] === 'openPullRequest')[1], { head: 'bob/BOB-1-task', base: 'master', title: 'BOB-1: Task 1', body: 'Opened by Bob coordination for attempt `attempt-1` (BOB-1).' });

  delete forge.state.branches['bob/BOB-1-task'];
  await succeed(f, { suffix: '2', itemId: 'item-2', extra: { publishSkippedReason: 'no changes' } });
  await pass(f, forge);
  snapshot = getItem(f, 'item-2');
  assert.equal(snapshot.release.stage, 'blocked');
  assert.equal(snapshot.state, 'validating');
  assert.match(snapshot.release.note, /no changes/);
  // Retry publishing once the branch exists.
  forge.state.branches['bob/BOB-1-task'] = sha('d');
  call(f.service, 'RequestRelease', { contractVersion: '1', commandId: 'publish-2', attemptId: 'attempt-2', action: 'open-pr', sourceRevision: sha('b') });
  assert.equal(getItem(f, 'item-2').release.stage, 'awaiting-publish');
  await pass(f, forge);
  assert.equal(getItem(f, 'item-2').release.stage, 'checks-running');
});

test('a branch that never appears blocks after the publish timeout', async t => {
  const f = setup(t), forge = fakeForge();
  delete forge.state.branches['bob/BOB-1-task'];
  await succeed(f, { extra: {} });
  const opened = Date.parse(getItem(f).release.updatedAt);
  await advanceReleases(f.service, forge, { now: opened + 60_000 });
  assert.equal(getItem(f).release.stage, 'awaiting-publish');
  await advanceReleases(f.service, forge, { now: opened + releaseTimings.publishTimeoutMs + 60_000 });
  assert.equal(getItem(f).release.stage, 'blocked');
});

test('a dependency on merged readies the downstream item once the upstream merges', async t => {
  const f = setup(t, { items: [item('item-1'), item('item-2', 'execution')], dependencies: [{ upstreamItemId: 'item-1', downstreamItemId: 'item-2', requiredMilestone: 'merged' }] }), forge = fakeForge();
  await succeed(f);
  assert.equal(getItem(f, 'item-2').state, 'pending');
  await pass(f, forge); await pass(f, forge);
  assert.equal(getItem(f, 'item-2').state, 'pending', 'review-ready does not satisfy merged');
  await pass(f, forge);
  assert.equal(getItem(f, 'item-2').state, 'ready');
});

test('completionTarget merged completes at merge; no ForgeGraph app blocks production verification', async t => {
  const f = setup(t, { items: [item('item-1', 'merged'), item('item-2', 'production')] }), forge = fakeForge();
  await succeed(f);
  for (let i = 0; i < 4; i++) await pass(f, forge);
  assert.equal(getItem(f).state, 'completed');
  assert.equal(getItem(f).release.stage, 'merged');
  forge.state.prs[7] = { state: 'open', merged: false, mergeSha: null, headSha: sha('d'), mergeable: true };
  forge.state.app = null;
  await succeed(f, { suffix: '2', itemId: 'item-2' });
  for (let i = 0; i < 5; i++) await pass(f, forge);
  const snapshot = getItem(f, 'item-2');
  assert.equal(snapshot.state, 'deploying');
  assert.equal(snapshot.release.stage, 'blocked');
  assert.match(snapshot.release.note, /No ForgeGraph app/);
});

test('rollback runs through ForgeGraph only for the recorded deployment', async t => {
  const f = setup(t), forge = fakeForge();
  forge.state.deployments = [{ id: 'dep-1', status: 'active', historyStatus: 'active', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', storePath: null, versionId: 'v1' }];
  await succeed(f);
  for (let i = 0; i < 5; i++) await pass(f, forge);
  let snapshot = getItem(f);
  assert.equal(snapshot.release.stage, 'production-verified');
  const body = { contractVersion: '1', commandId: 'rollback-1', itemId: 'item-1', action: 'rollback', artifactRef: 'dep-1', stageRef: 'production', deploymentRef: 'dep-1' };
  assert.throws(() => call(f.service, 'RequestDeployment', { ...body, commandId: 'rb-x', artifactRef: 'dep-0' }), code('RevisionConflict'));
  assert.throws(() => call(f.service, 'RequestDeployment', { ...body, commandId: 'rb-p', action: 'promote' }), code('CapabilityUnavailable'));
  const op = call(f.service, 'RequestDeployment', body, { actor: 'bob-user-1' });
  await pass(f, forge);
  assert.deepEqual(forge.state.calls.filter(c => c[0] === 'rollback'), [['rollback', 'dep-1']]);
  snapshot = getItem(f);
  assert.equal(snapshot.release.stage, 'blocked');
  assert.match(snapshot.release.note, /rolled back/);
  assert.equal(f.service.call('GetOperation', query(op.operationId)).state, 'succeeded');
});

test('a cancelled item retires its release and a network error backs off', async t => {
  const f = setup(t), forge = fakeForge({ async pullRequest() { throw Object.assign(new Error('down'), { code: 'ForgeUnavailable' }); } });
  await succeed(f);
  await pass(f, forge);
  const summary = await pass(f, forge);
  assert.equal(summary.errors, 1);
  assert.equal((await pass(f, forge)).processed, 0, 'backed off');
  call(f.service, 'CancelItem', { contractVersion: '1', commandId: 'cancel', itemId: 'item-1', expectedVersion: getItem(f).resourceVersion });
  const retired = await pass(f, forge, T0 + 10 * 60_000);
  assert.deepEqual(retired.results.map(r => r.outcome), ['retired']);
  assert.equal(getItem(f).state, 'cancelled');
  assert.equal((await pass(f, forge, T0 + 20 * 60_000)).processed, 0, 'cancellation alone never closes the PR');
  assert.equal(forge.state.calls.some(c => c[0] === 'closePullRequest'), false);
});

test('itemStateFor and repoSlug', () => {
  assert.equal(itemStateFor('review-ready', 'review-ready', 'validating'), 'completed');
  assert.equal(itemStateFor('merged', 'merged', 'review'), 'completed');
  assert.equal(itemStateFor('merged', 'production', 'review'), 'deploying');
  assert.equal(itemStateFor('blocked', 'production', 'review'), 'review');
  assert.equal(repoSlug({ integrationId: 'forgegraph', repositoryId: 'gmackie/bob' }), 'gmackie/bob');
  assert.equal(repoSlug({ integrationId: 'forgegraph', repositoryId: 'bob' }, { repositories: { bob: 'gmackie/bob' } }), 'gmackie/bob');
  assert.equal(repoSlug({ integrationId: 'forgegraph', repositoryId: 'bob' }), null);
  assert.equal(repoSlug({ integrationId: 'github', repositoryId: 'a/b' }), null);
});

test('forgePort sends tokens only to configured hosts, never follows redirects, and maps Forgejo shapes', async () => {
  const seen = [];
  const transport = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization, redirect: init.redirect, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/branches/bob%2FBOB-1')) return Response.json({ commit: { id: sha('d') } });
    if (url.includes('/commits/' + sha('d') + '/status')) return Response.json({ state: 'success', total_count: 2 });
    if (url.endsWith('/pulls/7/reviews')) return new Response('{}', { status: 422 });
    if (url.endsWith('/pulls/7/merge')) return new Response(null, { status: 200 });
    if (url.endsWith('/pulls/7')) return Response.json({ state: 'closed', merged: true, merge_commit_sha: sha('e'), head: { sha: sha('d') } });
    if (url.includes('/api/fg/apps/blder-bot/health')) return Response.json({ app: 'blder-bot', health: { production: { status: 'degraded' } } });
    return new Response(null, { status: 404 });
  };
  const forge = forgePort({ forgejo: { instanceUrl: 'https://git.example', token: 'git-token' }, forgegraph: { baseUrl: 'https://fg.example', token: 'fg-token' }, fetch: transport });
  assert.equal(await forge.branchHead('gmackie/bob', 'bob/BOB-1'), sha('d'));
  assert.equal(await forge.branchHead('gmackie/bob', 'missing'), null);
  assert.deepEqual(await forge.combinedStatus('gmackie/bob', sha('d')), { state: 'success', total: 2 });
  assert.deepEqual(await forge.approve('gmackie/bob', 7, sha('d')), { approved: false, reason: 'approval refused (HTTP 422)' });
  assert.deepEqual(await forge.merge('gmackie/bob', 7, sha('d')), { merged: true, mergeSha: sha('e') });
  assert.equal(await forge.health('blder-bot', 'production'), 'degraded');
  assert.equal(await forge.forgegraphApp('gmackie/bob'), null);
  assert(seen.every(s => s.redirect === 'manual'));
  assert(seen.filter(s => s.url.startsWith('https://git.example')).every(s => s.auth === 'token git-token'));
  assert(seen.filter(s => s.url.startsWith('https://fg.example')).every(s => s.auth === 'Bearer fg-token'));
  assert.deepEqual(seen.find(s => s.url.endsWith('/merge')).body, { Do: 'merge', head_commit_id: sha('d'), delete_branch_after_merge: true });
});

test('release facts move Kanbanger to review and done, never regressing a closed issue', async t => {
  const f = setup(t), forge = fakeForge();
  forge.state.deployments = [{ id: 'dep-1', status: 'active', historyStatus: 'active', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' }];
  await succeed(f);
  for (let i = 0; i < 5; i++) await pass(f, forge);
  const issue = { id: 'item-1', identifier: 'BOB-1', team: { id: 'GMA', key: 'GMA' }, project: { id: 'bob' }, state: { id: 'started', name: 'In Progress', type: 'started' } };
  const states = [{ id: 'started', name: 'In Progress', type: 'started' }, { id: 'review', name: 'In Review', type: 'started' }, { id: 'done', name: 'Done', type: 'completed' }];
  const comments = [], moves = [];
  const client = {
    integrationId: 'kanbanger',
    async resolveIssue() { return issue; },
    async workflowStates() { return states; },
    async updateIssueState(id, stateId) { moves.push(stateId); issue.state = states.find(s => s.id === stateId); return { state: issue.state }; },
    async issueComments() { return comments.map(body => ({ body })); },
    async createComment(id, body) { comments.push(body); },
  };
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await deliverIssueEffect(f.service, client, { now: T0 + 3_600_000 }));
  assert.deepEqual(results.map(r => r.fact), ['admitted', 'execution-succeeded', 'pr-open', 'review-ready', 'merged', 'production-verified']);
  assert.deepEqual(moves, ['review', 'done']);
  assert.match(comments.at(-1), /verified in production/);
  assert.match(releaseCommentFor('x', { fact: 'review-ready', attemptId: 'a', pullRequest: { number: 7, url: 'https://git.example/p/7' }, headSha: sha('d') }, issue), /\[#7\]\(https:\/\/git\.example\/p\/7\)/);
});

test('a command queued while the driver is mid-step is kept; the step result is dropped', async t => {
  const f = setup(t, { autoMerge: false }), forge = fakeForge();
  await succeed(f);
  await pass(f, forge); await pass(f, forge);
  assert.equal(getItem(f).state, 'review');
  let queued;
  const slow = fakeForge({
    async pullRequest(repo, number) {
      // The person presses Merge while this pass is reading the PR.
      queued ??= call(f.service, 'RequestRelease', { contractVersion: '1', commandId: 'merge-mid', attemptId: 'attempt-1', action: 'merge', sourceRevision: sha('d') });
      return forge.pullRequest(repo, number);
    },
  });
  slow.state = forge.state;
  const summary = await advanceReleases(f.service, slow, { now: clock += 120_000 });
  assert.deepEqual(summary.results.map(r => r.outcome), ['conflict']);
  assert.equal(f.service.call('GetOperation', query(queued.operationId)).state, 'accepted');
  await pass(f, forge);
  assert.equal(getItem(f).state, 'deploying');
  assert.equal(f.service.call('GetOperation', query(queued.operationId)).state, 'succeeded');
});

test('a deployment replaced by a rollback is never production evidence', async t => {
  const f = setup(t), forge = fakeForge();
  await succeed(f);
  for (let i = 0; i < 4; i++) await pass(f, forge);
  assert.equal(getItem(f).release.stage, 'deploying');
  forge.state.ancestors[sha('1')] = [sha('1')];
  forge.state.deployments = [
    { id: 'dep-2', status: 'active', historyStatus: 'active', commitSha: sha('1'), createdAt: '2026-11-15T12:10:00Z' }, // rollback to pre-merge
    { id: 'dep-1', status: 'rolled_back', historyStatus: 'superseded', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' },
  ];
  await pass(f, forge);
  assert.equal(getItem(f).release.stage, 'deploying');
  assert.equal(getItem(f).state, 'deploying');
});

test('an in-progress deployment waits without churning the item, then times out', async t => {
  const f = setup(t), forge = fakeForge();
  await succeed(f);
  for (let i = 0; i < 4; i++) await pass(f, forge);
  forge.state.deployments = [{ id: 'dep-1', status: 'health_checking', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' }];
  await pass(f, forge, clock += 60_000);
  const version = getItem(f).resourceVersion;
  assert.equal(getItem(f).release.deploymentId, 'dep-1');
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).resourceVersion, version, 'an unchanged wait writes no new item version');
  await pass(f, forge, clock += releaseTimings.deployTimeoutMs + 60_000);
  assert.equal(getItem(f).release.stage, 'blocked');
  // Retry resumes the deploy watch where it was blocked.
  forge.state.deployments[0].status = 'active';
  call(f.service, 'RequestRelease', { contractVersion: '1', commandId: 'resume', attemptId: 'attempt-1', action: 'open-pr', sourceRevision: sha('d') });
  assert.equal(getItem(f).release.stage, 'deploying');
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).state, 'completed');
});

test('autoMerge never merges a head the agent did not publish; an explicit merge can', async t => {
  const f = setup(t), forge = fakeForge();
  forge.state.statuses[sha('7')] = { state: 'success', total: 3 };
  await succeed(f);
  await pass(f, forge);
  forge.state.prs[7].headSha = sha('7');               // someone else pushes to the branch
  await pass(f, forge); await pass(f, forge); await pass(f, forge);
  const snapshot = getItem(f);
  assert.equal(snapshot.state, 'review');
  assert.equal(snapshot.release.headSha, sha('7'));
  assert.match(snapshot.release.note, /not the published head/);
  assert.equal(forge.state.calls.some(c => c[0] === 'merge'), false);
  call(f.service, 'RequestRelease', { contractVersion: '1', commandId: 'merge-new', attemptId: 'attempt-1', action: 'merge', sourceRevision: sha('7') });
  forge.state.prs[7].headSha = sha('7');
  forge.merge = async (repo, number, head) => { Object.assign(forge.state.prs[number], { merged: true, state: 'closed', mergeSha: sha('e') }); return { merged: true, mergeSha: sha('e') }; };
  await pass(f, forge);
  assert.equal(getItem(f).release.stage, 'merged');
});

test('a retry that publishes nothing new does not adopt the previous attempt\'s head', async t => {
  const f = setup(t), forge = fakeForge();
  forge.state.statuses[sha('d')] = { state: 'failure', total: 1 };
  await succeed(f);
  await pass(f, forge); await pass(f, forge);
  const failed = getItem(f);
  assert.equal(failed.state, 'failed');
  call(f.service, 'RetryItem', { contractVersion: '1', commandId: 'retry', itemId: 'item-1', expectedVersion: failed.resourceVersion, previousAttemptId: 'attempt-1', reason: 'again' });
  const attemptId = getItem(f).currentAttemptId;
  const attempt = f.service.attempt(attemptId);
  assert.equal(JSON.parse(attempt.request).workspace.branch, 'bob/BOB-1-task-a2');
  await f.service.dispatchOne(port);
  call(f.service, 'RecordExecutionReceipt', receipt({ ...JSON.parse(attempt.request) }, {}));
  // The retry branch was cut from the old head and nothing new was pushed.
  forge.state.branches['bob/BOB-1-task-a2'] = sha('d');
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).release.stage, 'awaiting-publish', 'the old head on the retry branch is ignored');
  forge.state.branches['bob/BOB-1-task-a2'] = sha('5');
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).release.headSha, sha('5'));
});

test('forgePort treats a 405 on an already merged PR as merged and ignores fork PRs', async () => {
  const transport = async url => {
    if (url.endsWith('/pulls/7/merge')) return new Response(null, { status: 405 });
    if (url.endsWith('/pulls/7')) return Response.json({ state: 'closed', merged: true, merge_commit_sha: sha('e'), head: { sha: sha('d'), repo: { full_name: 'gmackie/bob' } } });
    if (url.includes('/pulls?state=open')) return Response.json([{ number: 3, head: { ref: 'b', repo: { full_name: 'evil/bob' } }, base: { ref: 'master' } }, { number: 4, head: { ref: 'b', repo: { full_name: 'gmackie/bob' } }, base: { ref: 'master' } }]);
    return new Response(null, { status: 404 });
  };
  const forge = forgePort({ forgejo: { instanceUrl: 'https://git.example', token: 't' }, fetch: transport });
  assert.deepEqual(await forge.merge('gmackie/bob', 7, sha('d')), { merged: true, mergeSha: sha('e') });
  assert.equal((await forge.findPullRequest('gmackie/bob', 'b', 'master')).number, 4);
});

/** CI fails on attempt-1's PR #7, then RetryItem supersedes it. Returns the new attempt id. */
async function failAndRetry(f, forge) {
  forge.state.statuses[sha('d')] = { state: 'failure', total: 1 };
  await succeed(f);
  await pass(f, forge); await pass(f, forge);
  const failed = getItem(f);
  assert.equal(failed.release.stage, 'checks-failed');
  call(f.service, 'RetryItem', { contractVersion: '1', commandId: 'retry', itemId: 'item-1', expectedVersion: failed.resourceVersion, previousAttemptId: 'attempt-1', reason: 'again' });
  return getItem(f).currentAttemptId;
}
const releaseOf = (f, attemptId) => f.service.db.prepare('SELECT stage, data, next_check_at FROM coordination_release WHERE id=?').get(attemptId);
const closes = forge => forge.state.calls.filter(c => c[0] === 'closePullRequest');

test('a retry retires the superseded release and closes its open PR once, with a comment', async t => {
  const f = setup(t), forge = fakeForge();
  const next = await failAndRetry(f, forge);
  assert.deepEqual((await pass(f, forge)).results.map(r => r.outcome), ['retired'], 'the checks-failed release is due after the retry');
  assert.deepEqual((await pass(f, forge)).results.map(r => r.outcome), ['superseded-pr-closed']);
  assert.deepEqual(closes(forge), [['closePullRequest', 7, `Superseded by attempt ${next} (retry). Closed by Bob coordination.`]]);
  assert.equal(forge.state.prs[7].state, 'closed');
  const row = releaseOf(f, 'attempt-1');
  assert.equal(row.stage, 'retired');
  assert.deepEqual(JSON.parse(row.data).supersededPullRequest, { supersededBy: next, number: 7, outcome: 'closed', at: JSON.parse(row.data).updatedAt });
  assert.equal(row.next_check_at, Number.MAX_SAFE_INTEGER);
  for (let i = 0; i < 3; i++) await pass(f, forge, clock += 60 * 60_000);
  assert.equal(closes(forge).length, 1, 'idempotent across passes');
  assert.equal(getItem(f).currentAttemptId, next);
});

test('a superseded PR that was merged (or already closed) is never closed', async t => {
  const f = setup(t), forge = fakeForge();
  await failAndRetry(f, forge);
  Object.assign(forge.state.prs[7], { merged: true, state: 'closed', mergeSha: sha('e') });
  await pass(f, forge); await pass(f, forge);
  assert.deepEqual(closes(forge), []);
  assert.equal(JSON.parse(releaseOf(f, 'attempt-1').data).supersededPullRequest.outcome, 'merged');

  const g = setup(t), other = fakeForge();
  await failAndRetry(g, other);
  other.state.prs[7].state = 'closed';
  await pass(g, other); await pass(g, other);
  assert.deepEqual(closes(other), []);
  assert.equal(JSON.parse(releaseOf(g, 'attempt-1').data).supersededPullRequest.outcome, 'already-closed');
});

test('a failed close keeps the release retired and is retried after back-off', async t => {
  const f = setup(t);
  let down = true;
  const forge = fakeForge({
    async closePullRequest(repo, number, comment) {
      if (down) throw Object.assign(new Error('close pull request: HTTP 502'), { code: 'ForgeUnavailable' });
      forge.state.calls.push(['closePullRequest', number, comment]); forge.state.prs[number].state = 'closed';
    },
  });
  await failAndRetry(f, forge);
  await pass(f, forge);
  const failedClose = await pass(f, forge);
  assert.equal(failedClose.errors, 1);
  assert.deepEqual(failedClose.results.map(r => r.outcome), ['error']);
  assert.equal(releaseOf(f, 'attempt-1').stage, 'retired', 'the retirement is kept');
  assert.equal(JSON.parse(releaseOf(f, 'attempt-1').data).supersededPullRequest, undefined);
  assert.equal((await pass(f, forge)).processed, 0, 'backed off');
  down = false;
  assert.deepEqual((await pass(f, forge, clock += releaseTimings.pollMs * 2)).results.map(r => r.outcome), ['superseded-pr-closed']);
  assert.equal(closes(forge).length, 1);
  assert.equal(forge.state.prs[7].state, 'closed');
});

test('the PR title carries the issue key once', async t => {
  assert.equal(pullRequestTitle('BOB-86', 'record the receipt'), 'BOB-86: record the receipt');
  assert.equal(pullRequestTitle('BOB-86', 'BOB-86: record the receipt'), 'BOB-86: record the receipt');
  assert.equal(pullRequestTitle('BOB-86', 'bob-86 record the receipt'), 'bob-86 record the receipt');
  assert.equal(pullRequestTitle('BOB-8', 'BOB-86: other work'), 'BOB-8: BOB-86: other work');
  assert.equal(pullRequestTitle('BOB-86', 'BOB-86'), 'BOB-86: BOB-86');
  assert.equal(pullRequestTitle(undefined, 'Task'), 'Task');

  const f = setup(t), forge = fakeForge();
  const r = { ...request(f), work: { ...request(f).work, title: 'BOB-1: Task 1' } };
  call(f.service, 'RequestExecution', r);
  await f.service.dispatchOne(port);
  call(f.service, 'RecordExecutionReceipt', receipt(r, {}));
  await pass(f, forge);
  assert.equal(forge.state.calls.find(c => c[0] === 'openPullRequest')[1].title, 'BOB-1: Task 1');
});

test('forgePort closePullRequest closes, then comments best-effort, and errors carry only the HTTP status', async () => {
  const seen = [];
  let fail = {};
  const transport = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.authorization, redirect: init.redirect, signal: init.signal instanceof AbortSignal, body: init.body ? JSON.parse(init.body) : null });
    const hit = Object.keys(fail).find(path => url.endsWith(path));
    if (hit && fail[hit] === 'network') throw new TypeError('fetch failed');
    if (hit) return new Response('{"message":"secret-token git-token leaked"}', { status: fail[hit], headers: { 'x-token': 'git-token' } });
    if (url.endsWith('/issues/7/comments')) return Response.json({ id: 1 }, { status: 201 });
    if (url.endsWith('/pulls/7')) return Response.json({ number: 7, state: 'closed' });
    return new Response(null, { status: 404 });
  };
  const forge = forgePort({ forgejo: { instanceUrl: 'https://git.example/', token: 'git-token' }, fetch: transport });
  assert.deepEqual(await forge.closePullRequest('gmackie/bob', 7, 'Superseded by attempt a2 (retry). Closed by Bob coordination.'), { comment: 'posted' });
  assert.deepEqual(seen.map(s => [s.method, s.url, s.body]), [
    ['PATCH', 'https://git.example/api/v1/repos/gmackie/bob/pulls/7', { state: 'closed' }],
    ['POST', 'https://git.example/api/v1/repos/gmackie/bob/issues/7/comments', { body: 'Superseded by attempt a2 (retry). Closed by Bob coordination.' }],
  ]);
  assert(seen.every(s => s.redirect === 'manual' && s.signal && s.auth === 'token git-token'));

  // A failed close throws (the driver retries) and does not comment.
  fail = { '/pulls/7': 500 }; seen.length = 0;
  const error = await forge.closePullRequest('gmackie/bob', 7, 'x').then(() => null, e => e);
  assert.equal(error.message, 'close pull request: HTTP 500');
  assert.equal(error.status, 500);
  assert.doesNotMatch(JSON.stringify({ ...error, message: error.message, stack: error.stack }), /git-token|secret/);
  assert.equal(seen.length, 1, 'no comment after a failed close');

  // A refused or failed comment never undoes or blocks the close (production: a
  // write:repository token without write:issue gets 403 on comments).
  for (const [status, expected] of [[403, 'skipped (HTTP 403)'], [500, 'skipped (HTTP 500)'], ['network', 'skipped (network error)']]) {
    fail = { '/issues/7/comments': status }; seen.length = 0;
    const result = await forge.closePullRequest('gmackie/bob', 7, 'x');
    assert.deepEqual(result, { comment: expected });
    assert.doesNotMatch(JSON.stringify(result), /git-token|secret/);
    assert.deepEqual(seen.map(s => s.method), ['PATCH', 'POST']);
  }
});

test('a superseded PR is still closed when the comment is refused, and the skip is recorded', async t => {
  const f = setup(t);
  const forge = fakeForge({
    async closePullRequest(repo, number, comment) {
      forge.state.calls.push(['closePullRequest', number, comment]); forge.state.prs[number].state = 'closed';
      return { comment: 'skipped (HTTP 403)' };
    },
  });
  const next = await failAndRetry(f, forge);
  await pass(f, forge);
  assert.deepEqual((await pass(f, forge)).results.map(r => r.outcome), ['superseded-pr-closed']);
  assert.equal(forge.state.prs[7].state, 'closed');
  const recorded = JSON.parse(releaseOf(f, 'attempt-1').data).supersededPullRequest;
  assert.deepEqual(recorded, { supersededBy: next, number: 7, outcome: 'closed', comment: 'skipped (HTTP 403)', at: recorded.at });
});

test('production requires healthy evidence and a nonempty artifact for the live revision', async t => {
  const f = setup(t), forge = fakeForge();
  await succeed(f);
  for (let i = 0; i < 4; i++) await pass(f, forge);
  forge.state.deployments = [{ id: 'dep-1', status: 'active', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' }];
  for (const health of ['unknown', 'degraded', 'critical', null]) {
    forge.state.health = health;
    await pass(f, forge, clock += 60_000);
    assert.equal(getItem(f).state, 'deploying', String(health));
  }
  forge.state.health = 'healthy';
  forge.state.deployments[0].versionId = ' ';
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).state, 'deploying', 'missing artifact');
  forge.state.deployments[0].versionId = 'v1';
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).state, 'completed');
  const effect = JSON.parse(f.service.db.prepare("SELECT payload FROM coordination_issue_effect WHERE fact='production-verified'").get().payload);
  assert.equal(effect.artifactRef, 'v1');
  assert.equal(effect.deployedSha, sha('e'));
  assert.equal(effect.health, 'healthy');
  assert.equal(effect.verifiedAt, new Date(clock).toISOString());
});

test('rollback during the health read cannot certify the former deployment', async t => {
  const f = setup(t), forge = fakeForge();
  await succeed(f);
  for (let i = 0; i < 4; i++) await pass(f, forge);
  forge.state.deployments = [{ id: 'dep-1', status: 'active', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' }];
  forge.health = async () => { forge.state.deployments = []; return 'healthy'; };
  await pass(f, forge, clock += 60_000);
  assert.equal(getItem(f).state, 'deploying');
  assert.equal(f.service.db.prepare("SELECT COUNT(*) AS n FROM coordination_issue_effect WHERE fact='production-verified'").get().n, 0);
});

test('rollback revokes production readiness and skips a delayed issue closure', async t => {
  const f = setup(t, { items: [item(), item('item-2')], dependencies: [{ upstreamItemId: 'item-1', downstreamItemId: 'item-2', requiredMilestone: 'production-verified' }] }), forge = fakeForge();
  forge.state.deployments = [{ id: 'dep-1', status: 'active', commitSha: sha('e'), createdAt: '2026-11-15T12:05:00Z', versionId: 'v1' }];
  await succeed(f);
  for (let i = 0; i < 5; i++) await pass(f, forge);
  assert.equal(getItem(f, 'item-2').state, 'ready');
  call(f.service, 'RequestDeployment', { contractVersion: '1', commandId: 'rollback', itemId: 'item-1', action: 'rollback', artifactRef: 'dep-1', stageRef: 'production' });
  await pass(f, forge);
  assert.equal(getItem(f).state, 'failed');
  assert(!getItem(f).achievedMilestones.includes('production-verified'));
  assert.equal(getItem(f, 'item-2').state, 'pending');
  // Isolate the already queued closure. No network write may occur for it.
  f.service.db.prepare("UPDATE coordination_issue_effect SET status='delivered' WHERE fact != 'production-verified'").run();
  const database = f.service.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main').file;
  const restarted = new ExecutionCoordinator({ database, context: baseContext });
  let result;
  try {
    result = await deliverIssueEffect(restarted, { integrationId: 'kanbanger', resolveIssue() { assert.fail('stale closure must not contact Kanbanger'); } });
  } finally { restarted.close(); }
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.fact, 'production-verified');

});
