#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { ExecutionCoordinator } from './execution.mjs';
import { executionPort } from './execution-port.mjs';
import { kanbangerClient, loadKanbangerConfig } from './kanbanger.mjs';
import { drainIssueEffects, backoffMs } from './issue-effects.mjs';

const errorOf = error => ({ code: error?.code ?? 'InternalError', message: String(error?.message ?? error).slice(0, 500) });

/** One loop: DispatchOnce (the unchanged lease/FindExecution path), then drain the
 * Kanbanger effect outbox. A stop signal is honoured between steps, so a step in
 * flight finishes and settles its lease normally. */
export async function runWorker({ coordinator, port, kanbanger, intervalMs = 5000, signal, log = line => console.log(JSON.stringify(line)), random = Math.random, inProgressStateName, drainLimit = 10 }) {
  if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 3600000) throw new Error('Invalid interval');
  let failures = 0;
  log({ at: new Date().toISOString(), step: 'start', intervalMs });
  while (!signal?.aborted) {
    let worked = false, failed = false;
    try {
      const result = await coordinator.dispatchOne(port);
      const outcome = result.dispatched ? 'dispatched' : result.state ?? 'idle';
      if (result.error) failed = true;
      worked = Boolean(result.attemptId);
      log({ at: new Date().toISOString(), step: 'dispatch', outcome, ...(result.attemptId ? { attemptId: result.attemptId } : {}), ...(result.error ? { error: errorOf(result.error) } : {}) });
    } catch (error) { failed = true; log({ at: new Date().toISOString(), step: 'dispatch', outcome: 'error', error: errorOf(error) }); }
    if (kanbanger) {
      try {
        const summary = await drainIssueEffects(coordinator, kanbanger, { limit: drainLimit, random, ...(inProgressStateName ? { inProgressStateName } : {}) });
        if (summary.retry || summary.leaseLost) failed = true;
        worked ||= summary.processed > 0;
        log({ at: new Date().toISOString(), step: 'drain', outcome: summary.processed ? 'processed' : 'idle', processed: summary.processed, delivered: summary.delivered, retry: summary.retry, rejected: summary.rejected, skipped: summary.skipped, leaseLost: summary.leaseLost,
          effects: summary.results.map(({ effectId, fact, outcome, action, error }) => ({ effectId, fact, outcome, ...(action ? { action } : {}), ...(error ? { error: errorOf(error) } : {}) })) });
      } catch (error) { failed = true; log({ at: new Date().toISOString(), step: 'drain', outcome: 'error', error: errorOf(error) }); }
    }
    failures = failed ? failures + 1 : 0;
    // Jittered: errors back off exponentially; idle waits ~intervalMs; work continues promptly.
    const delay = failed ? Math.min(backoffMs(failures - 1, random) / 5, 60000) : worked ? 0 : Math.round(intervalMs * (0.8 + 0.4 * random()));
    if (signal?.aborted) break;
    try { await sleep(delay, undefined, { signal }); } catch { break; }
  }
  log({ at: new Date().toISOString(), step: 'stop', outcome: 'stopped' });
}

async function main() {
  const { values } = parseArgs({ options: { database: { type: 'string' }, context: { type: 'string' }, bindings: { type: 'string' }, kanbanger: { type: 'string' }, 'interval-ms': { type: 'string', default: '5000' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('bob-coordinate-worker --database <sqlite-file> --context <policy.json> --bindings <environment-bindings.json> --kanbanger <kanbanger.json> [--interval-ms <ms>]'); return; }
  if (!values.database || !values.context || !values.bindings || !values.kanbanger) throw Object.assign(new Error('Use --help for required arguments'), { code: 'InvalidRequest' });
  const intervalMs = Number(values['interval-ms']);
  const config = loadKanbangerConfig(values.kanbanger);
  const kanbanger = kanbangerClient(config);
  const port = executionPort({ bindings: JSON.parse(readFileSync(values.bindings, 'utf8')) });
  const coordinator = new ExecutionCoordinator({ database: values.database, context: JSON.parse(readFileSync(values.context, 'utf8')) });
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
  try { await runWorker({ coordinator, port, kanbanger, intervalMs, signal: controller.signal, inProgressStateName: config.inProgressStateName }); }
  finally { coordinator.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ at: new Date().toISOString(), step: 'fatal', error: errorOf(error) })); process.exitCode = 1; });
}
