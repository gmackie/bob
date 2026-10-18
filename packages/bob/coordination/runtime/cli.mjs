#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { ExecutionCoordinator } from './execution.mjs';
import { executionPort } from './execution-port.mjs';
import { kanbangerClient, kanbangerIssueResolver, loadKanbangerConfig } from './kanbanger.mjs';
let coordinator;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    database: { type: 'string' }, context: { type: 'string' }, input: { type: 'string' },
    'idempotency-key': { type: 'string' }, bindings: { type: 'string' }, kanbanger: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('bob-coordinate <ForgeC operation> --database <sqlite-file> --context <trusted-policy.json> --input <request.json|-> [--idempotency-key <commandId|requestId>] [--kanbanger <kanbanger.json>]\nbob-coordinate DispatchOnce --database <sqlite-file> --context <trusted-policy.json> --bindings <environment-bindings.json>');
  } else {
    if (positionals.length !== 1 || !values.database || !values.context || (positionals[0] !== 'DispatchOnce' && !values.input)) throw new Error('Use --help for required arguments');
    if (positionals[0] === 'DispatchOnce' && !values.bindings) throw new Error('DispatchOnce requires --bindings');
    const context = JSON.parse(readFileSync(values.context, 'utf8'));
    const input = values.input ? JSON.parse(readFileSync(values.input === '-' ? 0 : values.input, 'utf8')) : null;
    const issueResolver = values.kanbanger ? kanbangerIssueResolver(kanbangerClient(loadKanbangerConfig(values.kanbanger))) : undefined;
    coordinator = new ExecutionCoordinator({ database: values.database, context, issueResolver });
    const result = positionals[0] === 'DispatchOnce'
      ? await coordinator.dispatchOne(executionPort({ bindings: JSON.parse(readFileSync(values.bindings, 'utf8')) }))
      : await coordinator.admit(positionals[0], input, { idempotencyKey: values['idempotency-key'] ?? input.commandId ?? input.requestId });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'InvalidRequest', message: error.message, status: error.status ?? 400 }));
  process.exitCode = 1;
} finally { coordinator?.close(); }
