#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { Coordinator } from './coordinator.mjs';
let coordinator;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    database: { type: 'string' }, context: { type: 'string' }, input: { type: 'string' },
    'idempotency-key': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('bob-coordinate <ForgeC operation> --database <sqlite-file> --context <trusted-policy.json> --input <request.json|-> [--idempotency-key <commandId>]');
  } else {
    if (positionals.length !== 1 || !values.database || !values.context || !values.input) throw new Error('Use --help for required arguments');
    const context = JSON.parse(readFileSync(values.context, 'utf8'));
    const input = JSON.parse(readFileSync(values.input === '-' ? 0 : values.input, 'utf8'));
    coordinator = new Coordinator({ database: values.database, context });
    const result = coordinator.call(positionals[0], input, { idempotencyKey: values['idempotency-key'] ?? input.commandId });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'InvalidRequest', message: error.message, status: error.status ?? 400 }));
  process.exitCode = 1;
} finally { coordinator?.close(); }
