#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { flightdeckExporter, loadFlightdeckConfig } from './flightdeck.mjs';
import { edgeExporter, loadEdgeConfig } from './edge.mjs';
import { ExecutionCoordinator } from './execution.mjs';
import { executionPort } from './execution-port.mjs';
import { kanbangerClient, kanbangerIssueResolver, loadKanbangerConfig } from './kanbanger.mjs';
import { drainIssueEffects, backoffMs } from './issue-effects.mjs';

const errorOf = error => ({ code: error?.code ?? 'InternalError', message: String(error?.message ?? error).slice(0, 500) });

const exporterState = () => ({ failures: 0, retryAt: 0 });

/** Flushes one best-effort exporter with its own capped backoff. A failure is logged
 * without its message (it may carry endpoint or token detail) and never stops dispatch.
 * Flightdeck reports `{ exported }`, the edge `{ kind, sent }`; only a non-zero count logs,
 * so idle flushes and edge heartbeats stay quiet. Returns the flush result, if any. */
async function flushExporter(step, exporter, state, log) {
  if (!exporter || Date.now() < state.retryAt) return undefined;
  try {
    const result = await exporter.flush();
    state.failures = 0; state.retryAt = 0;
    const count = result?.exported ?? result?.sent ?? 0;
    if (count) log({ at: new Date().toISOString(), step, outcome: 'exported', count });
    if (result?.commands || result?.results) log({ at: new Date().toISOString(), step, outcome: 'commands', executed: result.commands ?? 0, reported: result.results ?? 0 });
    return result;
  } catch {
    state.retryAt = Date.now() + Math.min(1000 * 2 ** Math.min(state.failures++, 6), 60000);
    log({ at: new Date().toISOString(), step, outcome: 'unavailable' });
  }
}

/** One loop: DispatchOnce (the unchanged lease/FindExecution path), then drain the
 * Kanbanger effect outbox. A stop signal is honoured between steps, so a step in
 * flight finishes and settles its lease normally. */
/** BOB-76: admit new submissions only while Bob's budget governor has a slot.
 * Fails open (admits) when the allowance cannot be read, like autoDrain falls
 * back to its legacy pacing, so a Bob outage never stalls the factory. */
export function budgetAdmission({ url, token, fetch: transport = fetch, timeoutMs = 5000, log = () => {} }) {
  return async request => {
    try {
      const response = await transport(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const allowance = await response.json();
      if (allowance?.enforce !== true) return true;
      return Number(allowance.totalSlots) > 0;
    } catch (error) {
      log({ at: new Date().toISOString(), step: 'budget', outcome: 'unavailable', executionProfileId: request?.executionProfileId, error: String(error?.message ?? error).slice(0, 200) });
      return true;
    }
  };
}

export async function runWorker({ coordinator, port, kanbanger, flightdeck, edge, intervalMs = 5000, signal, log = line => console.log(JSON.stringify(line)), random = Math.random, inProgressStateName, drainLimit = 10, admit }) {
  if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 3600000) throw new Error('Invalid interval');
  let failures = 0; const analytics = exporterState(), edgeState = exporterState();
  log({ at: new Date().toISOString(), step: 'start', intervalMs });
  while (!signal?.aborted) {
    let worked = false, failed = false;
    try {
      const result = await coordinator.dispatchOne(port, admit ? { admit } : {});
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
    await flushExporter('flightdeck', flightdeck, analytics, log);
    const edgeResult = await flushExporter('edge', edge, edgeState, log);
    failures = failed ? failures + 1 : 0;
    // Jittered: errors back off exponentially; idle waits ~intervalMs; work continues promptly.
    let delay = failed ? Math.min(backoffMs(failures - 1, random) / 5, 60000) : worked ? 0 : Math.round(intervalMs * (0.8 + 0.4 * random()));
    // Edge command channel: while commands flow the exporter asks for a fast poll (~2 s).
    if (!failed && Number.isSafeInteger(edgeResult?.pollMs) && edgeResult.pollMs > 0) delay = Math.min(delay, edgeResult.pollMs);
    if (signal?.aborted) break;
    try { await sleep(delay, undefined, { signal }); } catch { break; }
  }
  log({ at: new Date().toISOString(), step: 'stop', outcome: 'stopped' });
}

async function main() {
  const { values } = parseArgs({ options: { database: { type: 'string' }, context: { type: 'string' }, bindings: { type: 'string' }, kanbanger: { type: 'string' }, flightdeck: { type: 'string' }, edge: { type: 'string' }, budget: { type: 'string' }, 'interval-ms': { type: 'string', default: '5000' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('bob-coordinate-worker --database <sqlite-file> --context <policy.json> --bindings <environment-bindings.json> --kanbanger <kanbanger.json> [--interval-ms <ms>] [--flightdeck <analytics.json>] [--edge <edge.json>]'); return; }
  if (!values.database || !values.context || !values.bindings || !values.kanbanger) throw Object.assign(new Error('Use --help for required arguments'), { code: 'InvalidRequest' });
  const intervalMs = Number(values['interval-ms']);
  const config = loadKanbangerConfig(values.kanbanger);
  const kanbanger = kanbangerClient(config);
  const port = executionPort({ bindings: JSON.parse(readFileSync(values.bindings, 'utf8')) });
  const coordinator = new ExecutionCoordinator({ database: values.database, context: JSON.parse(readFileSync(values.context, 'utf8')) });
  let flightdeck;
  if (values.flightdeck) {
    try { flightdeck = flightdeckExporter({ coordinator, ...loadFlightdeckConfig(values.flightdeck) }); }
    catch { console.error(JSON.stringify({ at: new Date().toISOString(), step: 'flightdeck', outcome: 'configuration-unavailable' })); }
  }
  let edge, edgePrincipal;
  if (values.edge) {
    try {
      const edgeConfig = loadEdgeConfig(values.edge);
      // The edge principal: the worker's trusted context, the configured relayed-operation
      // allowlist, its own connection, and the same Kanbanger issue admission as HTTP.
      if (edgeConfig.commands) edgePrincipal = new ExecutionCoordinator({ database: values.database, context: JSON.parse(readFileSync(values.context, 'utf8')), issueResolver: kanbangerIssueResolver(kanbanger) });
      edge = edgeExporter({ coordinator, ...edgeConfig, ...(edgeConfig.commands ? { commands: { ...edgeConfig.commands, coordinator: edgePrincipal } } : {}) });
    } catch {
      edgePrincipal?.close(); edgePrincipal = undefined;
      console.error(JSON.stringify({ at: new Date().toISOString(), step: 'edge', outcome: 'configuration-unavailable' }));
    }
  }
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
  // --budget <json>: { "url": "https://bob…/api/internal/budget-allowance", "token": "…" } (BOB-76).
  let admit;
  if (values.budget) {
    const budget = JSON.parse(readFileSync(values.budget, 'utf8'));
    if (typeof budget.url !== 'string' || typeof budget.token !== 'string') throw Object.assign(new Error('Invalid budget configuration'), { code: 'InvalidRequest' });
    admit = budgetAdmission({ url: budget.url, token: budget.token, log: line => console.log(JSON.stringify(line)) });
  }
  try { await runWorker({ coordinator, port, kanbanger, flightdeck, edge, intervalMs, signal: controller.signal, inProgressStateName: config.inProgressStateName, admit }); }
  finally { flightdeck?.close(); edge?.close(); edgePrincipal?.close(); coordinator.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ at: new Date().toISOString(), step: 'fatal', error: errorOf(error) })); process.exitCode = 1; });
}
