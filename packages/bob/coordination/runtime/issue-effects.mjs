import { randomUUID } from 'node:crypto';
import { fail } from './coordinator.mjs';
import { KanbangerError, sameTeam, sameProject } from './kanbanger.mjs';

/** Delivers durable Kanbanger lifecycle effects (coordination_issue_effect).
 * Rows were committed with the coordination fact; delivery happens later under a
 * lease, outside any SQLite transaction. Each write is read back before the row
 * is marked delivered. Comments carry a marker so a crash between the write and
 * the settle is detected on the next attempt rather than commenting twice. */
export const effectMarker = id => `bob-coordination-effect: ${id}`;
// Issue-specific failures cannot succeed by retrying; credentials/outages can.
const terminalCodes = new Set(['IssueNotFound', 'IssueMismatch', 'IssueProjectMismatch', 'StateUnavailable', 'InvalidRequest', 'IssueUnresolvable', 'Forbidden']);
const startedTypes = new Set(['started', 'completed', 'canceled', 'cancelled']);

export function backoffMs(attempts, random = Math.random) {
  const base = Math.min(5000 * 2 ** Math.min(attempts, 20), 15 * 60 * 1000);
  return Math.round(base * (0.8 + 0.4 * random()));
}

const short = value => (typeof value === 'string' && value.length > 16 ? value.slice(0, 12) : value);
export function commentFor(id, payload, issue) {
  const outcome = payload.fact.replace('execution-', '');
  const thread = payload.thread ? `${payload.thread.threadId} (environment ${payload.thread.environmentId}, project ${payload.thread.projectId}${payload.thread.turnId ? `, turn ${payload.thread.turnId}` : ''})` : 'unknown';
  const lines = [
    `**Bob coordination: execution ${outcome}** for ${issue.identifier}${payload.currentAttempt === false ? ' (superseded attempt)' : ''}`,
    '',
    `- Request: \`${payload.requestId}\``,
    `- Attempt: \`${payload.attemptId}\``,
    `- Environment: \`${payload.environmentId}\``,
    `- Execution: \`${payload.executionId}\``,
    `- Thread: ${thread}`,
    `- Checkpoint commit: \`${payload.commitSha}\` (${short(payload.commitSha)})`,
    `- Tree digest: \`${payload.treeDigest}\`${payload.dirty ? ` (dirty tree, patch artifact \`${payload.patchArtifactRef}\`)` : ''}`,
    `- Occurred at: ${payload.occurredAt}`,
  ];
  if (payload.evidenceRefs?.length) lines.push(`- Evidence: ${payload.evidenceRefs.map(ref => `\`${ref}\``).join(', ')}`);
  lines.push('', outcome === 'succeeded'
    ? 'This is an execution receipt only. It does not certify review, merge or production delivery, and Bob leaves the issue state unchanged.'
    : 'No issue state was changed. A retry, if any, is a new attempt.', '', effectMarker(id));
  return lines.join('\n');
}

/** BOB-82 release facts: the Kanbanger state each one sets (if any), and its comment. */
export const releaseFacts = Object.freeze({
  'pr-open': { title: 'pull request opened' },
  'review-ready': { title: 'CI passed, ready for review', state: 'review' },
  'checks-failed': { title: 'CI failed' },
  merged: { title: 'merged' },
  'production-verified': { title: 'verified in production', state: 'done' },
  blocked: { title: 'release blocked' },
  'rolled-back': { title: 'production deployment rolled back', state: 'reopen' },
});
export function releaseCommentFor(id, payload, issue) {
  const pr = payload.pullRequest ? (payload.pullRequest.url ? `[#${payload.pullRequest.number}](${payload.pullRequest.url})` : `#${payload.pullRequest.number}`) : 'none';
  const lines = [`**Bob release: ${releaseFacts[payload.fact].title}** for ${issue.identifier}`, '', `- Attempt: \`${payload.attemptId}\``, `- Pull request: ${pr}`];
  if (payload.headSha) lines.push(`- Head: \`${payload.headSha}\``);
  if (payload.mergeSha) lines.push(`- Merge commit: \`${payload.mergeSha}\``);
  if (payload.appSlug) lines.push(`- ForgeGraph app: \`${payload.appSlug}\`${payload.deploymentId ? `, production deployment \`${payload.deploymentId}\`` : ''}`);
  if (payload.artifactRef) lines.push(`- Artifact: \`${payload.artifactRef}\``);
  if (payload.deployedSha) lines.push(`- Deployed commit: \`${payload.deployedSha}\``);
  if (payload.verifiedAt) lines.push(`- Health: ${payload.health} at ${payload.verifiedAt}`);
  if (payload.note) lines.push(`- Note: ${payload.note}`);
  lines.push('', payload.fact === 'production-verified'
    ? 'The active production deployment contains the merge, has a recorded artifact and reports healthy app health, so Bob marked the issue done.'
    : payload.fact === 'review-ready' ? 'CI is green on the exact head. Bob moved the issue to review; it is done only after production is verified.'
      : payload.fact === 'rolled-back' ? 'Bob moved the issue back to in progress.'
      : 'Bob changed no issue state for this step.', '', effectMarker(id));
  return lines.join('\n');
}

/** The team's state for a release fact: review → the named review state (no fallback);
 * done → the named done state, else the first completed-type state. */
async function releaseState(client, issue, kind, names) {
  const states = await client.workflowStates(issue.team.id);
  const byName = name => states.find(state => state.name.toLowerCase() === name.toLowerCase());
  if (kind === 'review') return byName(names.reviewStateName) ?? null;
  if (kind === 'reopen') return byName(names.inProgressStateName ?? 'In Progress') ?? null;
  return byName(names.doneStateName) ?? states.filter(state => state.type === 'completed').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0] ?? null;
}

function claim(coordinator, { now, leaseMs, token }) {
  return coordinator.transaction(() => {
    const row = coordinator.db.prepare(`
      SELECT e.* FROM coordination_issue_effect e
      WHERE e.tenant=? AND e.owner=?
        AND (e.status='pending' OR (e.status='delivered' AND e.fact='rolled-back'))
        AND e.next_attempt_at<=? AND (e.lease_until IS NULL OR e.lease_until<=?)
        AND NOT EXISTS (
          SELECT 1 FROM coordination_issue_effect busy
          WHERE busy.tenant=e.tenant AND busy.status='pending' AND busy.lease_until>?
            AND json_extract(busy.payload,'$.issue.integrationId')=json_extract(e.payload,'$.issue.integrationId')
            AND json_extract(busy.payload,'$.issue.workspaceId')=json_extract(e.payload,'$.issue.workspaceId')
            AND json_extract(busy.payload,'$.issue.issueId')=json_extract(e.payload,'$.issue.issueId')
        ) ORDER BY e.rowid LIMIT 1`)
      .get(coordinator.tenant, coordinator.owner, now, now, now);
    if (!row) return null;
    coordinator.db.prepare("UPDATE coordination_issue_effect SET status='pending',lease_owner=?,lease_until=? WHERE tenant=? AND id=?").run(token, now + leaseMs, coordinator.tenant, row.id);
    return row;
  });
}

function settle(coordinator, row, token, { now, outcome, error, random }) {
  return coordinator.transaction(() => {
    const current = coordinator.db.prepare('SELECT * FROM coordination_issue_effect WHERE tenant=? AND id=?').get(coordinator.tenant, row.id);
    if (current.lease_owner !== token || current.status !== 'pending') return 'lease-lost';
    const attempts = current.delivery_attempts + 1;
    if (outcome === 'retry') {
      coordinator.db.prepare('UPDATE coordination_issue_effect SET delivery_attempts=?,last_error=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?')
        .run(attempts, error, now + backoffMs(current.delivery_attempts, random), coordinator.tenant, row.id);
    } else {
      coordinator.db.prepare('UPDATE coordination_issue_effect SET status=?,delivery_attempts=?,last_error=?,delivered_at=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?')
        .run(outcome, attempts, error ?? null, outcome === 'delivered' ? new Date(now).toISOString() : null, now + 60_000, coordinator.tenant, row.id);
    }
    return outcome;
  });
}

async function perform(client, row, payload, { inProgressStateName, reviewStateName = 'In Review', doneStateName = 'Done' }) {
  const issue = await client.resolveIssue(payload.issue.identifier ?? payload.issue.issueId);
  if (![issue.id, issue.identifier].includes(payload.issue.issueId)) throw new KanbangerError('IssueMismatch', 'Resolved issue identity differs from the admitted issue');
  if (!sameTeam(issue, payload.issue.teamId) || !sameProject(issue, payload.issue.projectId)) throw new KanbangerError('IssueProjectMismatch', 'Issue moved outside the admitted team/project');
  if (payload.fact === 'admitted') {
    // Never regress an issue already started, in review or closed.
    if (issue.state && startedTypes.has(issue.state.type)) return { action: 'state-unchanged', issue: issue.identifier, state: issue.state.name };
    const states = await client.workflowStates(issue.team.id);
    const wanted = inProgressStateName.toLowerCase();
    const target = states.find(state => state.name.toLowerCase() === wanted)
      ?? states.filter(state => state.type === 'started').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    if (!target) throw new KanbangerError('StateUnavailable', `Team has no "${inProgressStateName}" or started workflow state`);
    const after = await client.updateIssueState(issue.id, target.id);
    return { action: 'state-set', issue: issue.identifier, state: after.state.name };
  }
  const release = releaseFacts[payload.fact];
  let stateAction = null;
  if (release?.state) {
    // Never move a closed issue; review never regresses an issue already done.
    // A rollback reopens a done issue; nothing else moves a closed one.
    const closed = issue.state && (release.state === 'reopen' ? ['canceled', 'cancelled'] : ['completed', 'canceled', 'cancelled']).includes(issue.state.type);
    const target = closed ? null : await releaseState(client, issue, release.state, { reviewStateName, doneStateName, inProgressStateName });
    if (!closed && !target && release.state === 'reopen') throw new KanbangerError('ReopenStateUnavailable', 'Cannot reconcile rollback without an in-progress state', { retryable: true });
    if (target && target.id !== issue.state?.id) stateAction = (await client.updateIssueState(issue.id, target.id)).state.name;
  }
  const marker = effectMarker(row.id);
  if ((await client.issueComments(issue.id)).some(comment => comment.body.includes(marker))) return { action: stateAction ? 'state-set' : 'comment-present', issue: issue.identifier, ...(stateAction ? { state: stateAction } : {}) };
  await client.createComment(issue.id, release ? releaseCommentFor(row.id, payload, issue) : commentFor(row.id, payload, issue));
  if (!(await client.issueComments(issue.id)).some(comment => comment.body.includes(marker))) throw new KanbangerError('KanbangerReadBackMismatch', 'Created comment is not visible on read-back', { retryable: true });
  return { action: 'comment-created', issue: issue.identifier, ...(stateAction ? { state: stateAction } : {}) };
}

/** A remote write cannot be fenced with a local snapshot check. Rearm the durable
 * reopening obligation if a closure became invalid, even if another worker took
 * its expired lease and already delivered the original rollback effect. The rearm
 * is committed before settling the closure, so retries survive process death. */
function invalidateClosure(coordinator, payload) {
  if (payload.fact !== 'production-verified') return false;
  return coordinator.transaction(() => {
    const { snapshot } = coordinator.item(payload.itemId);
    if (snapshot.currentAttemptId === payload.attemptId && snapshot.state === 'completed'
      && snapshot.release?.stage === 'production-verified' && snapshot.release.deploymentId === payload.deploymentId) return false;
    const rollback = coordinator.db.prepare("SELECT * FROM coordination_issue_effect WHERE tenant=? AND owner=? AND attempt_id=? AND fact='rolled-back' ORDER BY rowid DESC LIMIT 1")
      .get(coordinator.tenant, coordinator.owner, snapshot.currentAttemptId);
    if (rollback && snapshot.state !== 'completed') {
      coordinator.db.prepare("UPDATE coordination_issue_effect SET status='pending',next_attempt_at=0 WHERE tenant=? AND id=? AND lease_owner IS NULL")
        .run(coordinator.tenant, rollback.id);
    }
    return true;
  });
}

/** Delivers at most one pending effect. Returns { delivered: false } when idle. */
export async function deliverIssueEffect(coordinator, client, { now = Date.now(), leaseMs = 60000, inProgressStateName = 'In Progress', reviewStateName, doneStateName, random = Math.random } = {}) {
  if (!Number.isSafeInteger(now) || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) fail('InvalidRequest', 'Invalid effect lease', 400);
  const token = randomUUID();
  const row = claim(coordinator, { now, leaseMs, token });
  if (!row) return { delivered: false };
  const payload = JSON.parse(row.payload);
  const base = { effectId: row.id, fact: row.fact, attemptId: row.attempt_id };
  if (payload.issue.integrationId !== client.integrationId) {
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome: 'skipped', error: 'Issue belongs to another integration' }) };
  }
  if (!coordinator.context.issueProjects.some(project => ['integrationId', 'workspaceId', 'teamId', 'projectId'].every(key => project[key] === payload.issue[key]))) {
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome: 'rejected', error: 'Issue project is outside the trusted policy' }), error: { code: 'Forbidden' } };
  }
  // Rollback effects remain periodic reconciliation obligations. This also repairs
  // a late remote write whose worker died after losing its lease. Stop when a newer
  // attempt or a new verified delivery owns the issue lifecycle.
  if (payload.fact === 'rolled-back') {
    const { snapshot } = coordinator.item(payload.itemId);
    if (snapshot.currentAttemptId !== payload.attemptId || snapshot.state === 'completed') {
      return { ...base, outcome: settle(coordinator, row, token, { now, outcome: 'skipped', error: 'Rollback is no longer current' }) };
    }
  }
  // Recovery also handles a crash after the remote write but before settlement.
  if (invalidateClosure(coordinator, payload)) {
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome: 'skipped', error: 'Production verification is no longer current' }) };
  }
  let result;
  try {
    result = await perform(client, row, payload, { inProgressStateName, ...(reviewStateName ? { reviewStateName } : {}), ...(doneStateName ? { doneStateName } : {}) });
  } catch (error) {
    const code = error.code ?? 'KanbangerUnavailable';
    const outcome = terminalCodes.has(code) ? 'rejected' : 'retry';
    const message = `${code}: ${String(error.message ?? '').slice(0, 1900)}`;
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome, error: message, random }), error: { code, message: error.message } };
  }
  coordinator.fault('before-effect-settle');
  if (invalidateClosure(coordinator, payload)) {
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome: 'skipped', error: 'Production verification changed during delivery' }) };
  }
  return { ...base, ...result, outcome: settle(coordinator, row, token, { now, outcome: 'delivered' }) };
}

/** Drains up to `limit` effects in one step. */
export async function drainIssueEffects(coordinator, client, { limit = 10, ...options } = {}) {
  const summary = { processed: 0, delivered: 0, retry: 0, rejected: 0, skipped: 0, leaseLost: 0, results: [] };
  for (let index = 0; index < limit; index++) {
    const result = await deliverIssueEffect(coordinator, client, options);
    if (!result.outcome) break;
    summary.processed++;
    summary[result.outcome === 'lease-lost' ? 'leaseLost' : result.outcome]++;
    summary.results.push(result);
  }
  return summary;
}
