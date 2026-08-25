#!/usr/bin/env node
/**
 * ci-check-phase — run one CI command as a check-events v2 configuration.
 *
 *   node scripts/ci-check-phase.mjs <typecheck|lint|test|e2e|build> -- <command...>
 *
 * Wraps the command with @forgegraph/check-events' runPhase: output is teed
 * to stdout untouched (so the job log reads as before), run_started /
 * run_finished events are appended to $FG_CHECK_EVENTS_PATH (default
 * .fg/check-events.ndjson), and the real exit code is preserved. Per-test
 * exactness for vitest comes from the in-process reporter each package's
 * `test` script is invoked with (see ci.yml), not from scraping this output.
 *
 * Used by .forgejo/workflows/ci.yml so ForgeGraph (and Bob's own cockpit,
 * via ForgeGraph's ci/gate) get typecheck ✓ · lint ✓ · test 57/58 ✗ for
 * every Bob build instead of a bare pass/fail.
 */
import { createCheckEventWriter, createPassthroughAdapter, runPhase } from "@forgegraph/check-events";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const phase = args[0];
const command = sep === -1 ? args.slice(1).join(" ") : args.slice(sep + 1).join(" ");
const PHASES = new Set(["typecheck", "lint", "test", "e2e", "build"]);

if (!PHASES.has(phase) || !command) {
  console.error("usage: ci-check-phase.mjs <typecheck|lint|test|e2e|build> -- <command...>");
  process.exit(2);
}

const writer = createCheckEventWriter(process.cwd(), process.env.FG_CHECK_EVENTS_PATH);
const result = await runPhase({
  cwd: process.cwd(),
  phase,
  command,
  writer,
  // Passthrough on every phase: the wrapper only marks run_started /
  // run_finished. Test counts come from the in-process vitest reporter
  // (exact, one stream per package); letting the wrapper scrape turbo's
  // interleaved vitest summaries on top would double-count them.
  adapter: createPassthroughAdapter(),
  env: process.env,
});
process.exit(result.exitCode);
