import { randomUUID } from 'node:crypto';
import { canonical, fail, releaseStatusValidator } from './coordinator.mjs';

/** BOB-82: the release of a succeeded attempt, from published branch to production.
 *
 * A row in coordination_release (id = attemptId) is opened in the same transaction as
 * the succeeded execution receipt. The worker's release driver (advanceReleases) claims
 * due rows under a lease, does the network work (Forgejo, ForgeGraph) outside any
 * transaction, then applies the result in one transaction that also moves the item:
 *
 *   awaiting-publish → checks-running → review-ready → merged → deploying → production-verified
 *
 * checks-failed fails the item (RetryItem starts a new attempt); blocked keeps the item
 * where it is with a note that needs a person. The driver only touches the PR it
 * recorded for the attempt, merges only at the exact head it saw green, and records
 * production evidence only for a ForgeGraph production deployment of a commit that
 * contains the merge, with app health not critical. */

const SHA = /^[a-f0-9]{40}$/;
export const releaseTimings = Object.freeze({
  pollMs: 30_000,
  /** awaiting-publish: how long to wait for the branch to appear on Forgejo. */
  publishTimeoutMs: 15 * 60_000,
  /** checks-running: how long a head may have no CI status at all. */
  noChecksTimeoutMs: 30 * 60_000,
  /** deploying: how long to wait for a production deployment of the merge. */
  deployTimeoutMs: 3 * 60 * 60_000,
  leaseMs: 120_000,
});
const live = new Set(['awaiting-publish', 'checks-running', 'review-ready', 'merged', 'deploying']);
const untrustedNote = 'The pull request head is not the published head: merge it explicitly once CI is green';
const note = text => (text ? String(text).replace(/\s+/g, ' ').trim().slice(0, 500) || null : null);

/** The item state a release stage implies. blocked keeps the item where it is. */
export function itemStateFor(stage, completionTarget, current, rolledBack = false) {
  if (rolledBack) return 'failed';
  switch (stage) {
    case 'awaiting-publish': case 'checks-running': return 'validating';
    case 'checks-failed': return 'failed';
    case 'review-ready': return completionTarget === 'review-ready' ? 'completed' : 'review';
    case 'merged': return completionTarget === 'production' ? 'deploying' : 'completed';
    case 'deploying': return 'deploying';
    case 'production-verified': return 'completed';
    default: return current;
  }
}
const milestoneOrder = ['execution-succeeded', 'review-ready', 'merged', 'production-verified'];
const impliedMilestones = { 'review-ready': ['review-ready'], merged: ['review-ready', 'merged'], deploying: ['review-ready', 'merged'], 'production-verified': ['review-ready', 'merged', 'production-verified'] };

/** owner/repo for the attempt's repository: the id itself when it has an owner, else the
 * policy's release.repositories mapping. */
export function repoSlug(repository, policy = {}) {
  if (repository?.integrationId !== 'forgegraph') return null;
  const mapped = policy.repositories?.[repository.repositoryId];
  const slug = typeof mapped === 'string' ? mapped : repository.repositoryId;
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug) ? slug : null;
}

/** The PR title: the work title, prefixed with the issue key unless it already starts
 * with it (case-insensitive, followed by `:` or whitespace). */
export function pullRequestTitle(identifier, title) {
  if (!identifier) return title;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(:|\\s)`, 'i').test(title) ? title : `${identifier}: ${title}`;
}

/** ReleaseStatus as projected onto ItemSnapshot.release. */
export function statusOf(data) {
  const status = {
    attemptId: data.attemptId, stage: data.stage, autoMerge: Boolean(data.autoMerge),
    branch: data.branch ?? null, headSha: data.headSha ?? null, pullRequest: data.pullRequest ?? null,
    approvedSha: data.approvedSha ?? null, mergeSha: data.mergeSha ?? null, appSlug: data.appSlug ?? null,
    deploymentId: data.deploymentId ?? null, note: note(data.note), updatedAt: data.updatedAt,
  };
  if (!releaseStatusValidator(status)) fail('InvalidRequest', 'Release status does not match the contract', 500);
  return status;
}

/** Opens the release for a succeeded attempt; called inside the receipt transaction. */
export function openRelease(coordinator, { attempt, request, receipt, definition, now = Date.now() }) {
  const declared = definition.items.find(item => item.itemId === attempt.item_id);
  const published = receipt.publishedHead ?? null;
  const at = new Date(now).toISOString();
  const data = {
    attemptId: attempt.id, itemId: attempt.item_id, planId: attempt.plan_id,
    stage: 'awaiting-publish',
    autoMerge: definition.autoMerge ?? coordinator.context.release?.autoMergeDefault ?? false,
    completionTarget: declared.completionTarget,
    repository: request.target.repository,
    branch: published?.branch ?? request.workspace.branch,
    headSha: published?.commitSha ?? null,
    // The head the environment published: autoMerge only ever merges this commit.
    trustedHead: published?.commitSha ?? null,
    pullRequest: published?.pullRequest ?? null,
    // Heads earlier attempts of this item published; a retry that publishes nothing new
    // must not adopt them from the shared branch.
    previousHeads: coordinator.db.prepare('SELECT data FROM coordination_release WHERE tenant=? AND owner=? AND item_id=? AND id<>?').all(coordinator.tenant, coordinator.owner, attempt.item_id, attempt.id)
      .map(row => JSON.parse(row.data)).flatMap(old => [old.trustedHead, old.headSha]).filter(Boolean).slice(-20),
    publishSkippedReason: receipt.publishSkippedReason ?? null,
    title: request.work.title,
    issue: declared.issue,
    openedAt: at, stageSince: at, updatedAt: at,
  };
  coordinator.db.prepare('INSERT INTO coordination_release (tenant,id,owner,item_id,plan_id,stage,data,check_attempts,next_check_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,id) DO NOTHING')
    .run(coordinator.tenant, attempt.id, coordinator.owner, attempt.item_id, attempt.plan_id, data.stage, canonical(data), 0, 0, at, at);
  return statusOf(data);
}

function releaseRow(coordinator, attemptId) {
  const row = coordinator.db.prepare('SELECT * FROM coordination_release WHERE tenant=? AND owner=? AND id=?').get(coordinator.tenant, coordinator.owner, attemptId);
  if (!row) fail('InvalidTransition', 'The attempt has no release', 409);
  return { row, data: JSON.parse(row.data) };
}

/** A command's write: data and schedule only. It never touches the lease, so a driver
 * step in flight sees the row changed (apply compares data) and discards its result. */
function commandSave(coordinator, row, data, { nextCheckAt, checkAttempts = row.check_attempts }) {
  coordinator.db.prepare('UPDATE coordination_release SET stage=?,data=?,check_attempts=?,next_check_at=?,updated_at=? WHERE tenant=? AND id=?')
    .run(data.stage, canonical(data), checkAttempts, nextCheckAt, data.updatedAt, coordinator.tenant, row.id);
}

function saveRow(coordinator, row, data, { nextCheckAt, checkAttempts = row.check_attempts }) {
  coordinator.db.prepare('UPDATE coordination_release SET stage=?,data=?,check_attempts=?,next_check_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE tenant=? AND id=?')
    .run(data.stage, canonical(data), checkAttempts, nextCheckAt, data.updatedAt, coordinator.tenant, row.id);
}

/** RequestRelease (inside the command transaction). merge/approve queue a request the
 * driver carries out on its next pass; the Operation stays accepted until then.
 * open-pr asks the driver to look for the published branch again. */
export function requestRelease(coordinator, body, options, { now = Date.now() } = {}) {
  const attempt = coordinator.attempt(body.attemptId);
  const { snapshot } = coordinator.item(attempt.item_id);
  if (options.expectItemId !== undefined && options.expectItemId !== attempt.item_id) fail('InvalidTransition', 'The attempt does not belong to this item');
  if (snapshot.currentAttemptId !== attempt.id) fail('InvalidTransition', 'The attempt is no longer current');
  const { row, data } = releaseRow(coordinator, attempt.id);
  if (data.command) fail('InvalidTransition', 'A release request is already pending');
  if (body.pullRequestRef !== undefined && body.pullRequestRef !== null && data.pullRequest && body.pullRequestRef !== String(data.pullRequest.number)) fail('RevisionConflict', 'The pull request changed; reload before acting');
  const at = new Date(now).toISOString();
  let operation;
  if (body.action === 'open-pr') {
    // "Retry": look for the published branch again, or resume a blocked release at the
    // stage it was blocked in (a rolled-back release resumes its deploy watch).
    if (!['awaiting-publish', 'blocked'].includes(data.stage)) fail('InvalidTransition', 'Only an unpublished or blocked release can be retried');
    const resumeAt = data.stage === 'blocked' && data.blockedFrom && data.blockedFrom !== 'blocked' ? data.blockedFrom : 'awaiting-publish';
    const next = { ...data, stage: resumeAt, note: null, blockedFrom: null, rolledBack: false, ...(resumeAt === 'awaiting-publish' ? { publishSkippedReason: null } : {}), stageSince: at, updatedAt: at };
    commandSave(coordinator, row, next, { nextCheckAt: 0, checkAttempts: 0 });
    operation = project(coordinator, snapshot, next, 'succeeded', body.commandId);
  } else {
    if (data.stage !== 'review-ready' || snapshot.state !== 'review') fail('InvalidTransition', 'The release is not ready for review actions');
    if (body.sourceRevision !== data.headSha) fail('RevisionConflict', 'The pull request head changed; reload before acting');
    operation = coordinator.operation(body.commandId, 'accepted', snapshot);
    const next = { ...data, command: { kind: 'release', action: body.action, commandId: body.commandId, operationId: operation.operationId, actor: options.actor ?? null, sourceRevision: body.sourceRevision }, updatedAt: at };
    commandSave(coordinator, row, next, { nextCheckAt: 0 });
    const item = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, operationIds: [...snapshot.operationIds.slice(-99), operation.operationId], release: statusOf(next) };
    coordinator.storeSnapshot(item, operation.operationId);
    operation.resourceVersion = item.resourceVersion;
    rewriteOperation(coordinator, operation);
  }
  return { itemId: attempt.item_id, value: operation };
}

/** RequestDeployment (inside the command transaction): rollback of the deployment the
 * release recorded. promote and deploy are not offered by this coordinator. */
export function requestDeployment(coordinator, body, options, { now = Date.now() } = {}) {
  const { snapshot } = coordinator.item(body.itemId);
  if (body.action !== 'rollback') fail('CapabilityUnavailable', 'Only rollback is supported; deploys follow the repository merge', 501);
  if (!snapshot.currentAttemptId) fail('InvalidTransition', 'The item has no release');
  const { row, data } = releaseRow(coordinator, snapshot.currentAttemptId);
  if (data.command) fail('InvalidTransition', 'A release request is already pending');
  if (!data.deploymentId || ![data.deploymentId].includes(body.artifactRef) || (body.deploymentRef != null && body.deploymentRef !== data.deploymentId)) fail('RevisionConflict', 'The deployment changed; reload before acting');
  if (body.stageRef !== 'production') fail('InvalidRequest', 'Only production deployments are tracked', 400);
  const operation = coordinator.operation(body.commandId, 'accepted', snapshot);
  const at = new Date(now).toISOString();
  const next = { ...data, command: { kind: 'deployment', action: 'rollback', commandId: body.commandId, operationId: operation.operationId, actor: options.actor ?? null, deploymentId: data.deploymentId }, updatedAt: at };
  commandSave(coordinator, row, next, { nextCheckAt: 0 });
  const item = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, operationIds: [...snapshot.operationIds.slice(-99), operation.operationId], release: statusOf(next) };
  coordinator.storeSnapshot(item, operation.operationId);
  operation.resourceVersion = item.resourceVersion;
  rewriteOperation(coordinator, operation);
  return operation;
}

function rewriteOperation(coordinator, operation) {
  coordinator.db.prepare('UPDATE coordination_operation SET receipt=? WHERE tenant=? AND id=?').run(canonical(operation), coordinator.tenant, operation.operationId);
}

/** Stores the item for a release change: state, milestones, release status, events. */
function project(coordinator, snapshot, data, opState, commandId) {
  const state = itemStateFor(data.stage, data.completionTarget, snapshot.state, data.rolledBack === true);
  // Milestones are cumulative: a merge also certifies review-ready, production also merged.
  const implied = impliedMilestones[data.stage] ?? [];
  const achievedMilestones = milestoneOrder.filter(m => snapshot.achievedMilestones.includes(m) || implied.includes(m));
  const next = { ...snapshot, resourceVersion: snapshot.resourceVersion + 1, state, achievedMilestones, release: statusOf(data) };
  let operation = null;
  if (commandId) {
    operation = coordinator.operation(commandId, opState, next);
    next.operationIds = [...snapshot.operationIds.slice(-99), operation.operationId];
  }
  coordinator.storeSnapshot(next, operation?.operationId ?? randomUUID());
  return operation ?? next;
}

/** Settles a queued release/deployment command on the driver's pass. */
function settleCommand(coordinator, command, itemId, outcome, error, resourceVersion) {
  const row = coordinator.db.prepare('SELECT receipt FROM coordination_operation WHERE tenant=? AND id=?').get(coordinator.tenant, command.operationId);
  if (row) rewriteOperation(coordinator, { ...JSON.parse(row.receipt), state: outcome, resourceVersion, error: outcome === 'failed' ? { code: error?.code ?? 'ReleaseFailed', message: String(error?.message ?? 'The release step failed').slice(0, 2000), retryable: false } : null });
  coordinator.logCommand(command.kind === 'deployment' ? 'RequestDeployment' : 'RequestRelease', command.commandId, {}, { resourceId: itemId, operationId: command.operationId, outcome, actor: command.actor });
}

/** checks-failed and retired rows are scheduled at NEVER; they are due only when a
 * RetryItem supersedes their attempt (BOB-88) or a retirement left a PR to close. */
function claim(coordinator, { now, leaseMs, token }) {
  return coordinator.transaction(() => {
    const row = coordinator.db.prepare(`SELECT * FROM coordination_release WHERE tenant=? AND owner=? AND stage IN ('awaiting-publish','checks-running','review-ready','merged','deploying','blocked','production-verified','checks-failed','retired')
      AND next_check_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_check_at, id LIMIT 1`).get(coordinator.tenant, coordinator.owner, now, now);
    if (!row) return null;
    coordinator.db.prepare('UPDATE coordination_release SET lease_owner=?,lease_until=? WHERE tenant=? AND id=?').run(token, now + leaseMs, coordinator.tenant, row.id);
    return row;
  });
}

const NEVER = Number.MAX_SAFE_INTEGER;
const age = (since, now) => now - Date.parse(since ?? new Date(now).toISOString());

/** Decides one release step. Network only; returns the new data plus side effects. */
export async function step(data, forge, { now, policy = {}, timings = releaseTimings }) {
  const at = new Date(now).toISOString();
  const moved = (stage, patch = {}) => ({ data: { ...data, ...patch, stage, stageSince: at, updatedAt: at }, changed: true });
  const stay = (patch = {}, delayMs = timings.pollMs) => ({ data: { ...data, ...patch, updatedAt: Object.keys(patch).length ? at : data.updatedAt }, changed: Object.keys(patch).length > 0, delayMs });
  const blocked = reason => ({ ...moved('blocked', { note: reason, blockedFrom: data.stage }), effect: 'blocked' });
  const repo = repoSlug(data.repository, policy);
  const command = data.command ?? null;

  // A requested rollback runs whatever stage the release is in.
  if (command?.kind === 'deployment') {
    try {
      await forge.rollback(command.deploymentId);
      return { ...moved('blocked', { note: `Production deployment ${command.deploymentId} rolled back`, blockedFrom: 'deploying', rolledBack: true, command: null }), settle: { command, outcome: 'succeeded' }, effect: 'rolled-back' };
    } catch (error) {
      return { ...stay({ command: null }), changed: true, settle: { command, outcome: 'failed', error } };
    }
  }
  if (!repo) return blocked('The repository is not a ForgeGraph owner/repo and is not mapped in the release policy');

  switch (data.stage) {
    case 'awaiting-publish': {
      let headSha = data.headSha ?? await forge.branchHead(repo, data.branch);
      // A head an earlier attempt published is not this attempt's work.
      if (!data.headSha && headSha && (data.previousHeads ?? []).includes(headSha)) headSha = null;
      if (!headSha) {
        if (data.publishSkippedReason) return blocked(`Nothing was published: ${data.publishSkippedReason}`);
        if (age(data.stageSince, now) > timings.publishTimeoutMs) return blocked(`Branch ${data.branch} was not published`);
        return stay();
      }
      let pullRequest = data.pullRequest;
      if (!pullRequest) {
        const base = await forge.defaultBranch(repo);
        const found = await forge.findPullRequest(repo, data.branch, base) ?? await forge.openPullRequest(repo, {
          head: data.branch, base,
          title: pullRequestTitle(data.issue?.identifier, data.title),
          body: `Opened by Bob coordination for attempt \`${data.attemptId}\`${data.issue?.identifier ? ` (${data.issue.identifier})` : ''}.`,
        });
        pullRequest = { repository: data.repository, number: found.number, ...(found.url ? { url: found.url } : {}) };
      }
      return { ...moved('checks-running', { headSha, trustedHead: data.trustedHead ?? headSha, pullRequest, note: null }), effect: 'pr-open' };
    }
    case 'checks-running':
    case 'review-ready': {
      // An item that completes at review-ready is done; its PR is no longer followed.
      if (data.stage === 'review-ready' && data.completionTarget === 'review-ready') return stay({}, NEVER);
      const pr = await forge.pullRequest(repo, data.pullRequest.number);
      if (pr.headRepo && pr.headRepo !== repo) return blocked(`Pull request #${data.pullRequest.number} comes from another repository`);
      if (pr.merged) return { ...moved('merged', { mergeSha: pr.mergeSha, note: null }), effect: 'merged', ...(command ? { settle: { command, outcome: 'succeeded' }, clearCommand: true } : {}) };
      if (pr.state === 'closed') return { ...blocked(`Pull request #${data.pullRequest.number} was closed without merging`), ...(command ? { settle: { command, outcome: 'failed', error: { code: 'PullRequestClosed', message: 'The pull request was closed' } }, clearCommand: true } : {}) };
      if (pr.headSha !== data.headSha) {
        // Someone pushed: the new head needs its own green CI and approval, and is not the
        // published head, so autoMerge no longer applies to it (only a merge naming it).
        return { ...moved('checks-running', { headSha: pr.headSha, approvedSha: null, note: null }), ...(command ? { settle: { command, outcome: 'failed', error: { code: 'RevisionConflict', message: 'The pull request head moved' } }, clearCommand: true } : {}) };
      }
      const checks = await forge.combinedStatus(repo, data.headSha);
      if (checks.state === 'failure' || checks.state === 'error') return { ...moved('checks-failed', { note: `CI failed on ${data.headSha.slice(0, 12)}` }), effect: 'checks-failed', ...(command ? { settle: { command, outcome: 'failed', error: { code: 'GatesUnsatisfied', message: 'CI failed' } }, clearCommand: true } : {}) };
      if (checks.state !== 'success' || !(checks.total > 0)) {
        if (data.stage === 'review-ready') return { ...moved('checks-running', { note: null }), ...(command ? { settle: { command, outcome: 'failed', error: { code: 'GatesUnsatisfied', message: 'CI is no longer green on the head' } }, clearCommand: true } : {}) };
        if (!(checks.total > 0) && age(data.stageSince, now) > timings.noChecksTimeoutMs) return blocked(`No CI reported for ${data.headSha.slice(0, 12)}`);
        return stay();
      }
      if (data.stage === 'checks-running') return { ...moved('review-ready', { note: null }), effect: 'review-ready' };
      // review-ready with green CI at the exact head.
      const trusted = data.trustedHead === data.headSha;
      const wantMerge = (data.autoMerge && trusted) || (command?.action === 'merge' && command.sourceRevision === data.headSha);
      const wantApprove = wantMerge || command?.action === 'approve';
      if (!wantApprove) return stay(data.autoMerge && !trusted && data.note !== untrustedNote ? { note: untrustedNote } : {}, timings.pollMs * 4);
      let patch = {};
      if (data.approvedSha !== data.headSha) {
        const review = await forge.approve(repo, data.pullRequest.number, data.headSha);
        patch = { approvedSha: review.approved ? data.headSha : data.approvedSha ?? null, ...(review.approved ? {} : { approvalNote: review.reason ?? 'approval refused' }) };
      }
      if (!wantMerge) {
        const refused = patch.approvedSha !== data.headSha;
        return { ...stay({ ...patch, command: null }), changed: true, settle: refused ? { command, outcome: 'failed', error: { code: 'GatesUnsatisfied', message: patch.approvalNote ?? 'approval refused' } } : { command, outcome: 'succeeded' } };
      }
      const merge = await forge.merge(repo, data.pullRequest.number, data.headSha);
      if (!merge.merged) return { ...blocked(`Merge refused: ${merge.reason ?? 'not mergeable'}`), ...(command ? { settle: { command, outcome: 'failed', error: { code: 'GatesUnsatisfied', message: merge.reason ?? 'not mergeable' } }, clearCommand: true } : {}) };
      return { ...moved('merged', { ...patch, mergeSha: merge.mergeSha, note: null }), effect: 'merged', ...(command ? { settle: { command, outcome: 'succeeded' }, clearCommand: true } : {}) };
    }
    case 'merged': {
      if (data.completionTarget !== 'production') return stay({}, NEVER);
      const appSlug = await forge.forgegraphApp(repo);
      if (!appSlug) return blocked('No ForgeGraph app is bound to this repository (.forgegraph.yaml), so production cannot be verified');
      return moved('deploying', { appSlug });
    }
    case 'deploying': {
      if (!data.mergeSha) return blocked('The merge commit is unknown');
      const timedOut = age(data.stageSince, now) > timings.deployTimeoutMs;
      const waiting = (reason, deploymentId) => {
        if (timedOut) return blocked(`${reason} after ${Math.round(timings.deployTimeoutMs / 3_600_000)} h`);
        return stay(deploymentId && deploymentId !== data.deploymentId ? { deploymentId } : {});
      };
      // Newest first. Only the deployment that is live now can be evidence: an older one
      // that contained the merge but was replaced (by a rollback or anything else) is not.
      const deployments = (await forge.deployments(data.appSlug, 'production'))
        .filter(d => SHA.test(d.commitSha ?? '') && Number.isFinite(Date.parse(d.createdAt)))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const containsMerge = async d => d.commitSha === data.mergeSha || await forge.containsCommit(repo, d.commitSha, data.mergeSha);
      const live = deployments.find(d => d.status === 'active');
      if (live && await containsMerge(live)) {
        const health = await forge.health(data.appSlug, 'production');
        if (health === 'critical') return waiting(`Production health is critical on deployment ${live.id}`, live.id);
        return { ...moved('production-verified', { deploymentId: live.id, deployedSha: live.commitSha, artifactRef: live.storePath ?? live.versionId ?? null, health, verifiedAt: at, note: null }), effect: 'production-verified' };
      }
      // Not live yet: is a deployment of the merge on its way, or did one fail?
      const newer = deployments.filter(d => !live || Date.parse(d.createdAt) > Date.parse(live.createdAt));
      for (const d of newer) {
        if (!(await containsMerge(d))) continue;
        if (['pending', 'deploying', 'health_checking', 'success_unchecked'].includes(d.status)) return waiting(`Production deployment ${d.id} did not become active`, d.id);
        if (d.status === 'failed') return waiting(`Production deployment ${d.id} of ${d.commitSha.slice(0, 12)} failed and no later one is active`, d.id);
      }
      return waiting(`No active production deployment contains ${data.mergeSha.slice(0, 12)}`);
    }
    default:
      // blocked and production-verified only wake up for commands.
      return stay({}, NEVER);
  }
}

/** Applies a step result: release row, item state, effects, command settlement. */
function apply(coordinator, row, token, result, { now, timings }) {
  return coordinator.transaction(() => {
    const current = coordinator.db.prepare('SELECT * FROM coordination_release WHERE tenant=? AND id=?').get(coordinator.tenant, row.id);
    if (current.lease_owner !== token) return 'lease-lost';
    // A command changed the row during the network step: drop this step's result (every
    // effect it may have had, an opened PR or a merge, is observed again next pass).
    if (current.data !== row.data) {
      coordinator.db.prepare('UPDATE coordination_release SET next_check_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?').run(now + 1, coordinator.tenant, row.id);
      return 'conflict';
    }
    let data = result.data;
    if (result.clearCommand) data = { ...data, command: null };
    const delay = result.delayMs ?? (live.has(data.stage) ? 0 : NEVER);
    // At least now + 1: a row advances one step per pass, so every due release gets a turn.
    saveRow(coordinator, current, data, { nextCheckAt: delay >= NEVER ? NEVER : now + Math.max(delay, 1), checkAttempts: result.changed ? 0 : current.check_attempts + 1 });
    if (!result.changed && !result.settle) return 'unchanged';
    const { snapshot } = coordinator.item(data.itemId);
    let resourceVersion = snapshot.resourceVersion;
    if (snapshot.currentAttemptId === data.attemptId && !['cancelling', 'cancelled'].includes(snapshot.state)) {
      const next = project(coordinator, snapshot, data);
      resourceVersion = next.resourceVersion;
      if (result.effect) {
        coordinator.db.prepare('INSERT OR IGNORE INTO coordination_issue_effect (tenant,id,owner,attempt_id,fact,payload,status,delivery_attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(coordinator.tenant, `${data.attemptId}:${result.effect}`, coordinator.owner, data.attemptId, result.effect, canonical({ fact: result.effect, issue: data.issue, planId: data.planId, itemId: data.itemId, attemptId: data.attemptId, pullRequest: data.pullRequest ?? null, headSha: data.headSha ?? null, mergeSha: data.mergeSha ?? null, appSlug: data.appSlug ?? null, deploymentId: data.deploymentId ?? null, note: data.note ?? null }), 'pending', 0, 0, new Date(now).toISOString());
      }
      if (['review-ready', 'merged', 'production-verified'].includes(data.stage)) coordinator.readyDependents(data.planId);
    }
    if (result.settle?.command) settleCommand(coordinator, result.settle.command, data.itemId, result.settle.outcome, result.settle.error, resourceVersion);
    return data.stage;
  });
}

/** BOB-88: closes the PR a superseded attempt's retired release recorded, once. The PR is
 * re-read first: a merged PR is never closed, one already closed is left alone. The
 * outcome is recorded on the release (supersededPullRequest), so later passes skip it;
 * a network error keeps the row retired and retries with the driver's back-off. The
 * explanatory comment is best-effort and its result is recorded as `comment`. */
async function closeSupersededPullRequest(coordinator, forge, row, data, token, { now, policy, timings, supersededBy }) {
  const save = (next, nextCheckAt, checkAttempts) => coordinator.transaction(() => coordinator.db.prepare('UPDATE coordination_release SET data=?,check_attempts=?,next_check_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=? AND lease_owner=?')
    .run(canonical(next), checkAttempts, nextCheckAt, coordinator.tenant, row.id, token));
  if (!supersededBy) { save(data, NEVER, row.check_attempts); return null; }
  const repo = repoSlug(data.repository, policy);
  const number = data.pullRequest.number;
  let outcome, comment;
  try {
    if (!repo) outcome = 'unmapped';
    else {
      const pr = await forge.pullRequest(repo, number);
      if (pr.merged) outcome = 'merged';
      else if (pr.state !== 'open') outcome = 'already-closed';
      else {
        const closed = await forge.closePullRequest(repo, number, `Superseded by attempt ${supersededBy} (retry). Closed by Bob coordination.`);
        outcome = 'closed';
        if (typeof closed?.comment === 'string') comment = closed.comment;
      }
    }
  } catch (error) {
    if (error?.code !== 'NotFound') {
      const backoff = Math.min(timings.pollMs * 2 ** Math.min(row.check_attempts, 5), 30 * 60_000);
      save(data, now + backoff, row.check_attempts + 1);
      return { attemptId: row.id, stage: 'retired', outcome: 'error', error: { code: error?.code ?? 'ForgeUnavailable', message: String(error?.message ?? error).slice(0, 300) } };
    }
    outcome = 'not-found';
  }
  const at = new Date(now).toISOString();
  save({ ...data, supersededPullRequest: { supersededBy, number, outcome, ...(comment ? { comment } : {}), at }, updatedAt: at }, NEVER, 0);
  return { attemptId: row.id, from: 'retired', outcome: `superseded-pr-${outcome}` };
}

/** One release pass for the worker: advances at most `limit` due releases. */
export async function advanceReleases(coordinator, forge, { now = Date.now(), limit = 5, policy = coordinator.context.release ?? {}, timings = releaseTimings, log = () => {} } = {}) {
  const summary = { processed: 0, changed: 0, errors: 0, results: [] };
  for (let index = 0; index < limit; index++) {
    const token = randomUUID();
    const row = claim(coordinator, { now, leaseMs: timings.leaseMs, token });
    if (!row) break;
    summary.processed++;
    const data = JSON.parse(row.data);
    let snapshot;
    try { ({ snapshot } = coordinator.item(row.item_id)); } catch (error) { if (error.code !== 'Forbidden' && error.code !== 'NotFound') throw error; }
    // BOB-88: superseded means a retry made another attempt current. Cancellation alone
    // never closes anything.
    const supersededBy = snapshot?.currentAttemptId && snapshot.currentAttemptId !== row.id ? snapshot.currentAttemptId : null;
    const closeDue = Boolean(supersededBy && data.pullRequest && !data.supersededPullRequest);
    if (row.stage === 'retired') {
      // Only a retired release whose superseded PR still has to be closed is ever due.
      const entry = await closeSupersededPullRequest(coordinator, forge, row, data, token, { now, policy, timings, supersededBy: closeDue ? supersededBy : null });
      if (entry) { if (entry.outcome === 'error') summary.errors++; summary.results.push(entry); log({ step: 'release', ...entry }); }
      continue;
    }
    // A superseded or cancelled attempt's release stops here.
    if (!snapshot || supersededBy || ['cancelling', 'cancelled'].includes(snapshot.state)) {
      coordinator.transaction(() => {
        const settleData = data.command ? { ...data, command: null } : data;
        // A superseded attempt's recorded PR is closed on a following pass.
        coordinator.db.prepare('UPDATE coordination_release SET stage=?,data=?,check_attempts=?,next_check_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=? AND lease_owner=?')
          .run('retired', canonical(settleData), closeDue ? 0 : row.check_attempts, closeDue ? now + 1 : NEVER, coordinator.tenant, row.id, token);
        if (data.command) settleCommand(coordinator, data.command, row.item_id, 'failed', { code: 'InvalidTransition', message: 'The attempt is no longer current' }, snapshot?.resourceVersion ?? 1);
      });
      summary.results.push({ attemptId: row.id, outcome: 'retired' });
      continue;
    }
    let result;
    try {
      result = await step(data, forge, { now, policy, timings });
    } catch (error) {
      summary.errors++;
      const backoff = Math.min(timings.pollMs * 2 ** Math.min(row.check_attempts, 5), 30 * 60_000);
      coordinator.transaction(() => coordinator.db.prepare('UPDATE coordination_release SET check_attempts=?,next_check_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=? AND lease_owner=?')
        .run(row.check_attempts + 1, now + backoff, coordinator.tenant, row.id, token));
      const entry = { attemptId: row.id, stage: data.stage, outcome: 'error', error: { code: error?.code ?? 'ForgeUnavailable', message: String(error?.message ?? error).slice(0, 300) } };
      summary.results.push(entry); log({ step: 'release', ...entry });
      continue;
    }
    const outcome = apply(coordinator, row, token, result, { now, timings });
    if (result.changed) summary.changed++;
    const entry = { attemptId: row.id, from: data.stage, outcome };
    summary.results.push(entry);
    if (result.changed) log({ step: 'release', ...entry });
  }
  return summary;
}
