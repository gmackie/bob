import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CoordinationError } from './coordinator.mjs';
import { parseIssuesConfig, policyProjectFor } from './issue-mirror.mjs';

const HEARTBEAT_MS = 30_000;
/** While commands flow, the exporter contacts the edge this often instead of every 30 s. */
export const FAST_POLL_MS = 2_000;
const MIN_POLL_MS = 1_000;
/** Operations the edge may relay; mirrors RELAYED_OPERATIONS in
 * packages/bob/src/sdlc-view/src/commands.ts. SetIssueState and DispatchIssue (BOB-99) are
 * run by the exporter itself (runIssueCommand), not by principal.admit. */
export const RELAYED_OPERATIONS = Object.freeze(['ControlPlan', 'RetryItem', 'CancelItem', 'ReconcileItem', 'ResolveInput', 'RequestRelease', 'RequestDeployment', 'SetIssueState', 'DispatchIssue']);
const ISSUE_OPERATIONS = new Set(['SetIssueState', 'DispatchIssue']);
/** Mirrors ISSUE_TARGETS in sdlc-view issues.ts. */
export const ISSUE_TARGETS = Object.freeze(['todo', 'in_progress', 'in_review', 'done', 'canceled']);
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Operations keyed by attemptId whose request has no itemId: the exporter sends the edge's
 * itemId as expectItemId and the coordinator checks the attempt belongs to that item. */
const ATTEMPT_KEYED = new Set(['ResolveInput', 'RequestRelease']);
const RELEASE_ACTIONS = new Set(['open-pr', 'approve', 'merge']);
const DEPLOYMENT_ACTIONS = new Set(['deploy', 'promote', 'rollback']);
const isSha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= 200;
// t3 runtime request ids (Codex async questions run to ~191 chars) — contract PromptId (BOB-85).
const isPromptId = v => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const isVersion = v => Number.isSafeInteger(v) && v >= 1;
/** Mirrors parseCommandInput in commands.ts: the operation input, or null. */
export function parseCommandInput(operation, input) {
  if (!isRecord(input)) return null;
  switch (operation) {
    case 'ControlPlan':
      return isId(input.planId) && isVersion(input.expectedVersion) && ['start', 'pause', 'resume', 'cancel'].includes(input.action)
        ? { planId: input.planId, expectedVersion: input.expectedVersion, action: input.action } : null;
    case 'RetryItem':
      return isId(input.itemId) && isVersion(input.expectedVersion) && isId(input.previousAttemptId) && typeof input.reason === 'string' && input.reason.length >= 1 && input.reason.length <= 2000
        ? { itemId: input.itemId, expectedVersion: input.expectedVersion, previousAttemptId: input.previousAttemptId, reason: input.reason } : null;
    case 'CancelItem':
      return isId(input.itemId) && isVersion(input.expectedVersion) ? { itemId: input.itemId, expectedVersion: input.expectedVersion } : null;
    case 'ReconcileItem':
      return isId(input.itemId) ? { itemId: input.itemId } : null;
    case 'ResolveInput':
      return isId(input.itemId) && isId(input.attemptId) && isPromptId(input.promptId) && typeof input.answer === 'string' && input.answer.length >= 1 && input.answer.length <= 16000
        ? { itemId: input.itemId, attemptId: input.attemptId, promptId: input.promptId, answer: input.answer } : null;
    case 'RequestRelease':
      if (!isId(input.itemId) || !isId(input.attemptId) || !RELEASE_ACTIONS.has(input.action) || !isSha(input.sourceRevision)) return null;
      if (input.pullRequestRef !== undefined && !isId(input.pullRequestRef)) return null;
      return { itemId: input.itemId, attemptId: input.attemptId, action: input.action, sourceRevision: input.sourceRevision, ...(input.pullRequestRef !== undefined ? { pullRequestRef: input.pullRequestRef } : {}) };
    case 'RequestDeployment':
      if (!isId(input.itemId) || !DEPLOYMENT_ACTIONS.has(input.action) || !isId(input.artifactRef) || !isId(input.stageRef)) return null;
      if (input.deploymentRef !== undefined && !isId(input.deploymentRef)) return null;
      return { itemId: input.itemId, action: input.action, artifactRef: input.artifactRef, stageRef: input.stageRef, ...(input.deploymentRef !== undefined ? { deploymentRef: input.deploymentRef } : {}) };
    case 'SetIssueState':
      return isUuid(input.issueId) && ISSUE_TARGETS.includes(input.target) ? { issueId: input.issueId, target: input.target } : null;
    case 'DispatchIssue':
      return isUuid(input.issueId) ? { issueId: input.issueId } : null;
    default:
      return null;
  }
}
const failure = (commandId, code, message, retryable = false) => ({ commandId, ok: false, error: { code: String(code).slice(0, 128), message: String(message).slice(0, 500), retryable } });
// The edge refuses larger ingest bodies (413): keep in step with MAX_INGEST_BYTES in apps/bob/worker/sdlc/store.ts.
export const MAX_BATCH_BYTES = 1_000_000;
// The edge refuses a batch with more results (400): MAX_RESULTS_PER_BATCH in apps/bob/worker/sdlc/store.ts.
export const MAX_RESULTS_PER_BATCH = 500;
/** What the edge is told about an error the coordinator did not raise itself: nothing of its text. */
export const INTERNAL_ERROR = Object.freeze({ code: 'InternalError', message: 'The coordinator could not run this command.', retryable: true });

/**
 * Whether a command's error is its final answer. Only a CoordinationError below 500 that
 * is not marked retryable is: the coordinator refused the command on its merits. Anything
 * else (storage busy, a network or Kanbanger failure, a 5xx, a bug) is transient: no result
 * is stored or reported, so the edge re-sends the command after its redelivery interval
 * (10 s) until it runs or the edge expires it (10 min). That bounds the retries; there is
 * no hot loop. The coordinator's idempotency makes a retry that already took effect a replay.
 */
export function classifyCommandError(error) {
  if (error instanceof CoordinationError && Number.isInteger(error.status) && error.status < 500 && error.retryable !== true) {
    return { final: true, error: { code: error.code, message: error.message, retryable: false } };
  }
  return { final: false, error: error instanceof CoordinationError ? { code: error.code, message: error.message, retryable: true } : INTERNAL_ERROR };
}

/** Kanbanger state names per ISSUE_TARGETS, case-insensitive; type fallbacks in pickWorkflowState. */
const TARGET_NAMES = Object.freeze({ todo: ['todo'], in_progress: ['in progress'], in_review: ['in review'], done: ['done'], canceled: ['canceled', 'cancelled'] });
/** The team's workflow state for a SetIssueState target: by name, else by type (lowest position first). */
export function pickWorkflowState(states, target) {
  const named = states.find(state => TARGET_NAMES[target]?.includes(String(state.name).trim().toLowerCase()));
  if (named) return named;
  const sorted = [...states].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const review = state => /review/i.test(state.name);
  switch (target) {
    case 'todo': return sorted.find(state => state.type === 'unstarted') ?? null;
    case 'in_progress': return sorted.find(state => state.type === 'started' && !review(state)) ?? null;
    case 'in_review': return sorted.find(state => state.type === 'started' && review(state)) ?? null;
    case 'done': return sorted.find(state => state.type === 'completed') ?? null;
    case 'canceled': return sorted.find(state => state.type === 'canceled') ?? null;
    default: return null;
  }
}
/** A branch name for a dispatched issue: `bob/<KEY>-<slug>`, lowercase slug, ≤ 80 characters. */
export function dispatchBranch(key, title) {
  const slug = String(title ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return `bob/${key}${slug ? `-${slug}` : ''}`;
}
/** Kanbanger said no (not a transport failure): final. Everything else follows classifyCommandError. */
function classifyIssueError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('Kanbanger') && error.code !== 'KanbangerUnavailable' && error.retryable !== true) {
    return { final: true, error: { code: error.code, message: String(error.message).slice(0, 500), retryable: false } };
  }
  if (error?.code === 'IssueNotFound' && error.retryable !== true) return { final: true, error: { code: 'IssueNotFound', message: 'Kanbanger issue not found', retryable: false } };
  return classifyCommandError(error);
}
const succeeded = (commandId, resourceId) => ({ contractVersion: '1', operationId: randomUUID(), commandId, state: 'succeeded', resourceId, resourceVersion: 0 });
const PAGE = 50, EVENTS = 100;
// Terminal plans (completed, cancelled) reach the edge through change batches when
// they finish; snapshots carry only the plans that can still move.
const LIVE_PLAN_STATES = ['draft', 'active', 'paused', 'cancelling'];

/** Pushes coordinator plan and item snapshots to Bob's SdlcEdge. Read-only:
 * it never changes domain state, and keeps its checkpoint in a separate database. */
/** commands: { operations, coordinator? } turns on the command channel. Commands
 * the edge returns run in-process under that edge principal (its own coordinator,
 * defaulting to the exporting one) and its operation allowlist; results ride the
 * next batch. Without it, every relayed command is answered Forbidden. */
/** issues (BOB-99): { kanbanger, mirror?, dispatch?, forge?, repositories? } runs SetIssueState
 * (kanbanger) and DispatchIssue (also dispatch: { executionProfileId, repository? } and forge:
 * a forgePort for the base revision). Without it both are answered NotSupported. */
export function edgeExporter({ coordinator, endpoint, token, checkpoint, fetch: send = fetch, timeoutMs = 5000, now = Date.now, maxBytes = MAX_BATCH_BYTES, commands, issues, log = line => console.error(JSON.stringify(line)) }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/sdlc/ingest') throw new Error('Edge needs an HTTPS /api/sdlc/ingest endpoint');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '') || !checkpoint || checkpoint === ':memory:') throw new Error('Invalid edge configuration');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid edge configuration');
  if (commands !== undefined && (!isRecord(commands) || !validOperations(commands.operations))) throw new Error('Invalid edge configuration');
  const allowed = new Set(commands?.operations ?? []);
  const principal = commands?.coordinator ?? coordinator;
  const source = coordinator.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  const destination = existsSync(checkpoint) ? realpathSync(checkpoint) : resolve(checkpoint);
  if (source && realpathSync(source) === destination) throw new Error('Edge checkpoint must be a separate database');
  const db = new DatabaseSync(checkpoint);
  db.exec('CREATE TABLE IF NOT EXISTS edge_checkpoint (owner TEXT PRIMARY KEY, position INTEGER NOT NULL, sent_at INTEGER NOT NULL)');
  // Results executed but not yet acknowledged by the edge; they survive a crash and are re-reported.
  db.exec('CREATE TABLE IF NOT EXISTS edge_command_result (owner TEXT NOT NULL, command_id TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (owner, command_id))');
  const owner = JSON.stringify([coordinator.tenant, coordinator.owner, url.href]);
  const read = () => db.prepare('SELECT position, sent_at FROM edge_checkpoint WHERE owner=?').get(owner);
  const save = position => db.prepare('INSERT INTO edge_checkpoint VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET position=excluded.position, sent_at=excluded.sent_at').run(owner, position, now());
  const reset = () => db.prepare('DELETE FROM edge_checkpoint WHERE owner=?').run(owner);
  const pendingResults = () => db.prepare('SELECT command_id, result FROM edge_command_result WHERE owner=? ORDER BY created_at, command_id').all(owner)
    .map(row => ({ commandId: row.command_id, result: JSON.parse(row.result) }));
  const hasResult = commandId => Boolean(db.prepare('SELECT 1 FROM edge_command_result WHERE owner=? AND command_id=?').get(owner, commandId));
  const keepResult = result => db.prepare('INSERT INTO edge_command_result VALUES (?,?,?,?) ON CONFLICT(owner, command_id) DO UPDATE SET result=excluded.result')
    .run(owner, result.commandId, JSON.stringify(result), now());
  const clearResults = ids => { for (const id of ids) db.prepare('DELETE FROM edge_command_result WHERE owner=? AND command_id=?').run(owner, id); };
  let pollMs = null; // fast-poll interval while commands flow, else null (30 s heartbeat)
  // Direct queries: the caller holds one read transaction, so bodies must stay contract-shaped.
  const q = (name, body) => coordinator.query(name, { contractVersion: '1', ...body });
  // A plan whose target or issue project left the trusted policy is not exported.
  const inPolicy = fn => { try { return fn(); } catch (error) { if (error.code === 'Forbidden') return null; throw error; } };
  const livePlanIds = coordinator.db.prepare(`SELECT id FROM coordination_plan WHERE tenant=? AND owner=? AND id>? AND state IN (${LIVE_PLAN_STATES.map(() => '?').join(',')}) ORDER BY id LIMIT ?`);
  const eventRows = coordinator.db.prepare('SELECT resource_id, sequence FROM coordination_event WHERE tenant=? AND owner=? AND sequence>? ORDER BY sequence LIMIT ?');

  function snapshot() {
    const watermark = coordinator.watermark(), plans = [], items = [];
    let afterPlanId = '', page;
    do {
      // Not ListPlans: it authorizes every row, so one out-of-policy plan would fail the page.
      page = livePlanIds.all(coordinator.tenant, coordinator.owner, afterPlanId, ...LIVE_PLAN_STATES, PAGE);
      for (const { id } of page) {
        const plan = inPolicy(() => q('GetPlan', { resourceId: id }));
        if (!plan) continue;
        plans.push(plan);
        for (const summary of plan.items) {
          const item = inPolicy(() => q('GetItem', { resourceId: summary.itemId }).item);
          if (item) items.push(item);
        }
      }
      afterPlanId = page.at(-1)?.id;
    } while (page.length === PAGE);
    return { kind: 'snapshot', watermark, plans, items };
  }

  function changes(position) {
    coordinator.parseCursor(coordinator.cursor(position)); // CursorExpired when the checkpoint is ahead of this store
    // Not ReadEvents: it authorizes every event, so one out-of-policy resource would fail the page.
    const events = eventRows.all(coordinator.tenant, coordinator.owner, position, EVENTS);
    if (!events.length) return null;
    const plans = [], items = [];
    for (const id of new Set(events.map(event => event.resource_id))) {
      const item = inPolicy(() => {
        try { return q('GetItem', { resourceId: id }).item; }
        catch (error) { if (error.code !== 'NotFound') throw error; return undefined; }
      });
      if (item) { items.push(item); continue; }
      if (item === null) continue;
      const plan = inPolicy(() => q('GetPlan', { resourceId: id }));
      if (plan) plans.push(plan);
    }
    return { kind: 'changes', fromSequence: position, watermark: events.at(-1).sequence, plans, items };
  }

  /** One deferred read transaction: a consistent view without a write lock. */
  function readBatch(fn) {
    coordinator.db.exec('BEGIN');
    try { const batch = fn(); coordinator.db.exec('COMMIT'); return batch; }
    catch (error) { coordinator.db.exec('ROLLBACK'); throw error; }
  }

  /** Serializes the batch with as many pending results as fit under maxBytes, at most MAX_RESULTS_PER_BATCH. */
  function encode(batch, pending) {
    const body = JSON.stringify({ contractVersion: '1', ...batch });
    const bytes = Buffer.byteLength(body);
    if (bytes > maxBytes) throw new Error(`Edge batch too large: ${bytes} bytes`);
    for (let count = Math.min(pending.length, MAX_RESULTS_PER_BATCH); count > 0; count--) {
      const results = pending.slice(0, count).map(entry => entry.result);
      const withResults = JSON.stringify({ contractVersion: '1', ...batch, results });
      if (Buffer.byteLength(withResults) <= maxBytes) return { body: withResults, sent: pending.slice(0, count).map(entry => entry.commandId) };
    }
    return { body, sent: [] };
  }

  /** Runs one relayed command. Never throws: every outcome is a CommandResult, or null
   * for a transient failure (nothing is stored; the edge re-sends the command later). */
  /** SetIssueState: move the issue to the team's state for the target, comment, and refresh the mirror. */
  async function setIssueState(commandId, { issueId, target }) {
    const kanbanger = issues.kanbanger;
    const issue = await kanbanger.resolveIssue(issueId);
    const state = pickWorkflowState(await kanbanger.workflowStates(issue.team.id), target);
    if (!state) return failure(commandId, 'IssueStateUnavailable', `The issue's team has no state for ${target}`, false);
    // Already there (a retry after it applied, or a stale screen): no second write or comment.
    if (issue.state?.id !== state.id) {
      await kanbanger.updateIssueState(issueId, state.id);
      await kanbanger.createComment(issueId, `Moved to ${state.name} from the Bob Arcade.`);
    }
    issues.mirror?.refresh(issueId);
    return { commandId, ok: true, operation: succeeded(commandId, issueId) };
  }

  /**
   * DispatchIssue: a one-item plan for the issue, started, and its first execution requested,
   * all under the edge principal (so Kanbanger issue admission applies). Every id derives from
   * the commandId, so a re-delivered command replays instead of creating a second plan.
   */
  async function dispatchIssue(commandId, { issueId }, actor) {
    const { kanbanger, dispatch, forge } = issues;
    if (!dispatch) return failure(commandId, 'NotSupported', 'Dispatch is not configured on this coordinator (edge.json issues.dispatch)', false);
    if (!forge) return failure(commandId, 'NotSupported', 'Dispatch needs the worker --release config to read the base revision', false);
    const node = await kanbanger.mirrorIssue(issueId);
    if (!node) return failure(commandId, 'IssueNotFound', 'Kanbanger issue not found', false);
    if (['completed', 'canceled'].includes(node.state?.type)) return failure(commandId, 'InvalidTransition', 'The issue is already closed', false);
    const policy = principal.context;
    const project = policyProjectFor(policy, node);
    if (!project) return failure(commandId, 'Forbidden', "The issue's project is outside the coordinator policy", false);
    const target = (policy.targets ?? []).find(t => t.repository?.integrationId === 'forgegraph');
    const repositories = { ...(policy.release?.repositories ?? {}), ...(issues.repositories ?? {}) };
    const repo = target && (dispatch.repository ?? repositories[target.repository.repositoryId] ?? (target.repository.repositoryId.includes('/') ? target.repository.repositoryId : null));
    if (!target || !repo) return failure(commandId, 'NotSupported', 'No ForgeGraph target with a known repository in the coordinator policy', false);
    const h = createHash('sha256').update(commandId).digest('hex').slice(0, 24);
    const itemId = `issue-${node.identifier}-${h.slice(0, 12)}`;
    const issueSnapshotRef = `kanbanger:${node.identifier}:${h.slice(0, 12)}`;
    const issueRef = { integrationId: 'kanbanger', workspaceId: project.workspaceId, teamId: project.teamId, projectId: project.projectId, issueId: node.id, identifier: node.identifier };
    const admit = (name, body, key) => (principal.admit ?? principal.call).call(principal, name, { contractVersion: '1', ...body }, { idempotencyKey: key, actor });
    const created = await admit('CreatePlan', { commandId: `dispatch-${h}-create`, plan: { items: [{ itemId, issue: issueRef, target, issueSnapshotRef, completionTarget: 'production' }], dependencies: [], concurrencyLimit: 1 } }, `dispatch-${h}-create`);
    const planId = created.resourceId;
    await admit('ControlPlan', { commandId: `dispatch-${h}-start`, planId, expectedVersion: 1, action: 'start' }, `dispatch-${h}-start`);
    const baseRevision = await forge.branchHead(repo, await forge.defaultBranch(repo));
    if (!baseRevision) return failure(commandId, 'BaseRevisionUnavailable', `No head commit for ${repo}'s default branch`, false);
    const description = (await kanbanger.issueDescription(issueId)).trim();
    const title = typeof node.title === 'string' && node.title.trim() ? node.title.trim() : node.identifier;
    const request = {
      requestId: `dispatch-${h}-request`, attemptId: `dispatch-${h}-attempt`, itemId, planId, planVersion: 2, issueSnapshotRef, target,
      work: {
        title: `${node.identifier}: ${title}`.slice(0, 240),
        instructions: (description || `Implement Kanbanger issue ${node.identifier}: ${title}.`).slice(0, 16000),
        acceptanceCriteria: [`Meet the acceptance criteria of Kanbanger issue ${node.identifier}${typeof node.url === 'string' && node.url.startsWith('https://') ? ` (${node.url})` : ''}.`.slice(0, 2000)],
      },
      workspace: { baseRevision, branch: dispatchBranch(node.identifier, title) },
      executionProfileId: dispatch.executionProfileId,
    };
    const operation = await admit('RequestExecution', request, request.requestId);
    issues.mirror?.refresh(issueId);
    const { error, ...rest } = operation;
    return { commandId, ok: true, operation: error == null ? rest : operation };
  }

  async function runIssueCommand(command, input) {
    const commandId = command.commandId;
    if (!issues?.kanbanger) return failure(commandId, 'NotSupported', 'Issue commands are not configured on this coordinator (edge.json issues)', false);
    try {
      return command.operation === 'SetIssueState' ? await setIssueState(commandId, input) : await dispatchIssue(commandId, input, command.actor);
    } catch (error) {
      const { final, error: reported } = classifyIssueError(error);
      if (final) return failure(commandId, reported.code, reported.message, reported.retryable);
      log({ at: new Date(now()).toISOString(), step: 'edge', outcome: 'command-transient', commandId, operation: command.operation, code: reported.code });
      return null;
    }
  }

  async function run(command) {
    const commandId = command.commandId;
    if (!allowed.has(command.operation)) return failure(commandId, 'Forbidden', 'Operation is outside the edge principal policy', false);
    const input = parseCommandInput(command.operation, command.input);
    if (!input) return failure(commandId, 'InvalidRequest', 'Command input is invalid', false);
    if (ISSUE_OPERATIONS.has(command.operation)) return runIssueCommand(command, input);
    // ResolveInputRequest and ReleaseRequest have no itemId: the coordinator checks it names the attempt's item.
    const keyed = ATTEMPT_KEYED.has(command.operation);
    const { itemId: expectItemId, ...attemptBody } = keyed ? input : {};
    const body = keyed ? attemptBody : input;
    try {
      const operation = await (principal.admit ?? principal.call).call(principal, command.operation, { contractVersion: '1', commandId, ...body }, { idempotencyKey: commandId, actor: command.actor, ...(expectItemId ? { expectItemId } : {}) });
      const { error, ...rest } = operation;
      return { commandId, ok: true, operation: error == null ? rest : operation };
    } catch (error) {
      const { final, error: reported } = classifyCommandError(error);
      if (final) return failure(commandId, reported.code, reported.message, reported.retryable);
      // Logged locally only, without the message (it may carry paths or upstream detail).
      log({ at: new Date(now()).toISOString(), step: 'edge', outcome: 'command-transient', commandId, operation: command.operation, code: reported.code });
      return null;
    }
  }

  async function execute(list) {
    let executed = 0;
    for (const command of list) {
      if (!isRecord(command) || typeof command.commandId !== 'string' || command.commandId.length < 1 || command.commandId.length > 200) continue; // nothing to correlate a result with
      if (hasResult(command.commandId)) continue; // already executed, awaiting report
      const result = !RELAYED_OPERATIONS.includes(command.operation) ? failure(command.commandId, 'InvalidRequest', 'Unknown operation', false)
        : typeof command.actor !== 'string' || command.actor.length < 1 || command.actor.length > 200 ? failure(command.commandId, 'InvalidRequest', 'Command actor is invalid', false)
        : await run(command);
      if (result === null) continue; // transient: re-delivered by the edge
      keepResult(result); executed++;
    }
    return executed;
  }

  async function post(batch, body) {
    const response = await send(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Edge unavailable'); }
    const result = await response.json();
    if (result.resync === true) { reset(); throw new Error('Edge requested a fresh snapshot'); }
    if (result.accepted !== true || result.watermark !== batch.watermark) throw new Error('Edge did not accept the batch');
    return result;
  }

  return {
    async flush() {
      const state = read();
      // The transaction closes here, before any network work.
      let batch = readBatch(() => {
        if (!state) return snapshot();
        try { return changes(state.position); }
        catch (error) { if (error.code !== 'CursorExpired') throw error; return snapshot(); }
      });
      const pending = pendingResults();
      if (!batch) {
        const wait = pending.length ? 0 : pollMs ?? HEARTBEAT_MS;
        if (now() - state.sent_at < wait) return { kind: 'idle', sent: 0, ...(pollMs ? { pollMs } : {}) };
        batch = { kind: 'heartbeat', watermark: state.position, plans: [], items: [] };
      }
      const { body, sent } = encode(batch, pending);
      const response = await post(batch, body);
      save(batch.watermark);
      clearResults(sent);
      // Commands are only taken from an accepted response; the edge re-sends anything unanswered.
      const received = Array.isArray(response.commands) ? response.commands : [];
      const executed = await execute(received);
      const asked = Number.isSafeInteger(response.pollMs) && response.pollMs > 0 ? Math.min(Math.max(response.pollMs, MIN_POLL_MS), HEARTBEAT_MS) : null;
      pollMs = asked ?? (received.length || pendingResults().length ? FAST_POLL_MS : null);
      return { kind: batch.kind, sent: batch.plans.length + batch.items.length, ...(sent.length ? { results: sent.length } : {}), ...(executed ? { commands: executed } : {}), ...(pollMs ? { pollMs } : {}) };
    },
    close() { db.close(); },
  };
}

function validOperations(operations) {
  return Array.isArray(operations) && operations.length > 0 && new Set(operations).size === operations.length && operations.every(name => RELAYED_OPERATIONS.includes(name));
}

/** edge.json `tail` block (BOB-80): {} or { postIntervalMs } (2000..30000 ms). Its presence
 * turns on the tail relay (runtime/tail.mjs); null when absent. */
export function parseTailConfig(tail) {
  if (tail === undefined) return null;
  if (!isRecord(tail) || Object.keys(tail).some(key => key !== 'postIntervalMs')) throw new Error('Edge tail must be an object with optional postIntervalMs');
  if (tail.postIntervalMs !== undefined && (!Number.isInteger(tail.postIntervalMs) || tail.postIntervalMs < 2000 || tail.postIntervalMs > 30_000)) throw new Error('Edge tail.postIntervalMs must be 2000..30000');
  return { postIntervalMs: tail.postIntervalMs ?? 2000 };
}

/** edge.json: { endpoint, checkpoint, tokenEnv, commands?: { operations: [...] }, tail?: {...}, issues?: {...} }.
 * `issues` (BOB-99, parseIssuesConfig) turns on the Kanbanger issue mirror and the issue
 * commands; it is returned as `issues` and is not an exporter option.
 * `commands` enables the command channel; its operations are the edge principal's
 * allowlist, a non-empty subset of RELAYED_OPERATIONS. The principal's context is
 * the worker's own --context policy (see deploy/coordination/README.md). `tail`
 * enables the tail relay; it is returned as `tail` and is not an exporter option. */
export function loadEdgeConfig(path, env = process.env) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof config.tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(config.tokenEnv)) throw new Error('Edge tokenEnv is required');
  const tail = parseTailConfig(config.tail);
  const issues = parseIssuesConfig(config.issues);
  const loaded = { endpoint: config.endpoint, checkpoint: config.checkpoint, token: env[config.tokenEnv], ...(tail ? { tail } : {}), ...(issues ? { issues } : {}) };
  if (config.commands === undefined) return loaded;
  if (!isRecord(config.commands) || Object.keys(config.commands).some(key => key !== 'operations') || !validOperations(config.commands.operations)) throw new Error('Edge commands.operations must be a non-empty, unique subset of ' + RELAYED_OPERATIONS.join(', '));
  return { ...loaded, commands: { operations: [...config.commands.operations] } };
}
