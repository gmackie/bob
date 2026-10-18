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

function claim(coordinator, { now, leaseMs, token }) {
  return coordinator.transaction(() => {
    const row = coordinator.db.prepare("SELECT * FROM coordination_issue_effect WHERE tenant=? AND owner=? AND status='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY rowid LIMIT 1")
      .get(coordinator.tenant, coordinator.owner, now, now);
    if (!row) return null;
    coordinator.db.prepare('UPDATE coordination_issue_effect SET lease_owner=?,lease_until=? WHERE tenant=? AND id=?').run(token, now + leaseMs, coordinator.tenant, row.id);
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
      coordinator.db.prepare('UPDATE coordination_issue_effect SET status=?,delivery_attempts=?,last_error=?,delivered_at=?,lease_owner=NULL,lease_until=NULL WHERE tenant=? AND id=?')
        .run(outcome, attempts, error ?? null, outcome === 'delivered' ? new Date(now).toISOString() : null, coordinator.tenant, row.id);
    }
    return outcome;
  });
}

async function perform(client, row, payload, { inProgressStateName }) {
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
  const marker = effectMarker(row.id);
  if ((await client.issueComments(issue.id)).some(comment => comment.body.includes(marker))) return { action: 'comment-present', issue: issue.identifier };
  await client.createComment(issue.id, commentFor(row.id, payload, issue));
  if (!(await client.issueComments(issue.id)).some(comment => comment.body.includes(marker))) throw new KanbangerError('KanbangerReadBackMismatch', 'Created comment is not visible on read-back', { retryable: true });
  return { action: 'comment-created', issue: issue.identifier };
}

/** Delivers at most one pending effect. Returns { delivered: false } when idle. */
export async function deliverIssueEffect(coordinator, client, { now = Date.now(), leaseMs = 60000, inProgressStateName = 'In Progress', random = Math.random } = {}) {
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
  let result;
  try {
    result = await perform(client, row, payload, { inProgressStateName });
  } catch (error) {
    const code = error.code ?? 'KanbangerUnavailable';
    const outcome = terminalCodes.has(code) ? 'rejected' : 'retry';
    const message = `${code}: ${String(error.message ?? '').slice(0, 1900)}`;
    return { ...base, outcome: settle(coordinator, row, token, { now, outcome, error: message, random }), error: { code, message: error.message } };
  }
  coordinator.fault('before-effect-settle');
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
