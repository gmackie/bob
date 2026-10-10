import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const api = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url)));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const operations = new Map(Object.values(api.paths).flatMap(path => Object.values(path))
  .filter(op => op.operationId).map(op => [op.operationId.split('/').at(-1), op]));
function validator(name, response = false) {
  const op = operations.get(name);
  assert(op, name);
  const schema = response ? op.responses['200'].content['application/json'].schema
    : op.requestBody.content['application/json'].schema;
  return ajv.compile(schema);
}
function valid(name, value, response = false) {
  const check = validator(name, response);
  assert(check(value), JSON.stringify(check.errors));
}
function invalid(name, value) { assert.equal(validator(name)(value), false); }
const repository = { integrationId: 'forgegraph', repositoryId: 'bob' };
const target = { environmentId: 'hetzner-bob', projectId: 'bob', repository };
const thread = { environmentId: 'hetzner-bob', projectId: 'bob', threadId: 'thread-1' };
const issue = { integrationId: 'kanbanger', workspaceId: 'gmacko', teamId: 'GMA', projectId: 'bob', issueId: 'issue-42', identifier: 'BOB-42' };
const plan = { items: [{ itemId: 'item-1', issue, target, issueSnapshotRef: 'snapshot-1', completionTarget: 'production' }], dependencies: [], concurrencyLimit: 2 };
const create = { contractVersion: '1', commandId: 'command-1', plan };
const execution = { contractVersion: '1', requestId: 'request-1', attemptId: 'attempt-1', itemId: 'item-1', planId: 'plan-1', planVersion: 1, issueSnapshotRef: 'snapshot-1', target, work: { title: 'Implement contract', instructions: 'Use ForgeC', acceptanceCriteria: ['Generated artifacts reproduce'] }, workspace: { baseRevision: 'a'.repeat(40), branch: 'BOB-42-forgec-contract' }, executionProfileId: 'cliapiproxy' };
const sourceSnapshot = { repository, commitSha: 'a'.repeat(40), treeDigest: 'b'.repeat(64), dirty: false };
const executionReceipt = { contractVersion: '1', eventId: 'event-1', environmentId: target.environmentId, executionId: 'execution-1', attemptId: execution.attemptId, sequence: 1, occurredAt: '2026-10-10T12:00:00Z', outcome: 'succeeded', thread, sourceSnapshot, evidenceRefs: [] };
const production = { contractVersion: '1', commandId: 'command-2', itemId: 'item-1', stageRef: 'production', deploymentId: 'deploy-1', sourceRevision: 'a'.repeat(40), artifactDigest: 'b'.repeat(64), healthEvidenceRefs: ['health-1'], verifiedAt: '2026-10-10T12:00:00Z' };

test('all twenty-three request and success schemas resolve and compile', () => {
  assert.equal(operations.size, 23);
  for (const name of operations.keys()) { validator(name); validator(name, true); }
});
test('realistic plan, admission, terminal receipts and production evidence', () => {
  valid('CreatePlan', create);
  valid('SubmitExecution', execution);
  valid('SubmitExecution', { contractVersion: '1', requestId: execution.requestId, executionId: 'execution-1', attemptId: execution.attemptId, target, thread }, true);
  valid('RecordExecutionReceipt', executionReceipt);
  valid('RecordValidationReceipt', { contractVersion: '1', eventId: 'event-2', environmentId: target.environmentId, attemptId: execution.attemptId, validationId: 'validation-1', sequence: 2, sourceSnapshot, checkProfileId: 'local', startedAt: '2026-10-10T12:00:00Z', finishedAt: '2026-10-10T12:01:00Z', exitCode: 0, outcome: 'succeeded', evidenceRefs: ['test-log'] });
  valid('RecordProductionEvidence', production);
  valid('CreatePlan', { contractVersion: '1', operationId: 'op-1', commandId: create.commandId, state: 'accepted', resourceId: 'plan-1', resourceVersion: 1, error: null }, true);
});
test('nested objects reject unknown fields and provider credentials', () => {
  invalid('SubmitExecution', { ...execution, apiKey: 'not-a-secret-fixture' });
  invalid('SubmitExecution', { ...execution, target: { ...target, providerToken: 'fixture' } });
  invalid('SubmitExecution', { ...execution, target: { ...target, repository: { ...repository, url: 'https://unexpected.example' } } });
});
test('version, environment, revision and outcome are constrained', () => {
  invalid('CreatePlan', { ...create, contractVersion: '2' });
  invalid('SubmitExecution', { ...execution, planVersion: 0 });
  const { environmentId, ...withoutEnvironment } = target;
  invalid('SubmitExecution', { ...execution, target: withoutEnvironment });
  invalid('SubmitExecution', { ...execution, workspace: { ...execution.workspace, baseRevision: 'main' } });
  invalid('RecordExecutionReceipt', { ...executionReceipt, outcome: 'running' });
  invalid('RecordExecutionReceipt', { ...executionReceipt, sequence: 0 });
  invalid('RecordExecutionReceipt', { ...executionReceipt, occurredAt: 'yesterday' });
});
test('bounded scope and plans reject oversized and empty payloads', () => {
  invalid('CreatePlan', { ...create, plan: { ...plan, items: [] } });
  invalid('CreatePlan', { ...create, plan: { ...plan, items: Array(101).fill(plan.items[0]) } });
  invalid('CreatePlan', { ...create, plan: { ...plan, concurrencyLimit: 33 } });
  invalid('SubmitExecution', { ...execution, work: { ...execution.work, acceptanceCriteria: [] } });
  invalid('SubmitExecution', { ...execution, work: { ...execution.work, instructions: 'x'.repeat(16001) } });
});
test('production evidence requires immutable artifact and health references', () => {
  invalid('RecordProductionEvidence', { ...production, healthEvidenceRefs: [] });
  invalid('RecordProductionEvidence', { ...production, artifactDigest: 'latest' });
  const { deploymentId, ...withoutDeployment } = production;
  invalid('RecordProductionEvidence', withoutDeployment);
});
test('nullable origin accepts null or a complete identity', () => {
  valid('CreatePlan', { ...create, origin: null });
  valid('CreatePlan', { ...create, origin: { environmentId: 'gmacko-mini', projectId: 'bob' } });
  invalid('CreatePlan', { ...create, origin: {} });
});

test('viewer snapshots expose version, current attempt and a resume watermark', () => {
  const item = { itemId: 'item-1', planId: 'plan-1', resourceVersion: 2, state: 'execution-unknown', currentAttemptId: 'attempt-1', execution: null, achievedMilestones: [], operationIds: ['op-1'], evidenceRefs: [] };
  valid('GetPlan', { contractVersion: '1', planId: 'plan-1', resourceVersion: 2, state: 'active', definition: plan, items: [{ itemId: item.itemId, resourceVersion: item.resourceVersion, state: item.state, currentAttemptId: item.currentAttemptId, achievedMilestones: [] }], eventCursor: 'cursor-2' }, true);
  valid('GetItem', { contractVersion: '1', item, eventCursor: 'cursor-2' }, true);
  const check = validator('GetItem', true);
  assert.equal(check({ contractVersion: '1', item }), false);
  assert.equal(check({ contractVersion: '1', item: { ...item, state: 'unknown-success' }, eventCursor: 'cursor-2' }), false);
});
