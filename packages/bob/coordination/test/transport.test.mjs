import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../generated/client.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createClient, ForgeError } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('caller-selected environment and stable IDs reach the execution transport', async () => {
  const calls = [];
  const client = createClient({ baseUrl: 'https://hetzner-bob.example/', fetch: async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ requestId: 'request-1', executionId: 'execution-1' }), { status: 200 });
  } });
  const input = { contractVersion: '1', requestId: 'request-1', attemptId: 'attempt-1', target: { environmentId: 'hetzner-bob' } };
  const options = { idempotencyKey: input.requestId };
  await client.functions.submitExecution(input, options);
  await client.functions.submitExecution(input, options);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].url, 'https://hetzner-bob.example/api/v1/execution/requests');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['idempotency-key'], 'request-1');
  assert.deepEqual(JSON.parse(calls[0].body), input);
});
test('coordination conflicts remain structured errors and are not silently retried', async () => {
  let calls = 0;
  const problem = { type: 'about:blank', title: 'Conflict', status: 409, code: 'VersionConflict', retryable: false };
  const client = createClient({ baseUrl: 'https://bob.example', fetch: async () => {
    calls++;
    return new Response(JSON.stringify(problem), { status: 409 });
  } });
  await assert.rejects(client.functions.controlPlan({ contractVersion: '1', commandId: 'cmd', planId: 'plan', expectedVersion: 1, action: 'start' }), error => error instanceof ForgeError && error.code === 'VersionConflict' && error.status === 409);
  assert.equal(calls, 1);
});
