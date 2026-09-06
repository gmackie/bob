#!/usr/bin/env node
/**
 * ci-check-phase — run one CI command as a check-events v2 configuration.
 *
 *   node scripts/ci-check-phase.mjs <typecheck|lint|test|e2e|build> -- <command...>
 *
 * Wraps the command with @forgegraph/check-events' runPhase: output is teed
 * to stdout untouched (so the job log reads as before), run_started /
 * run_finished events are appended to $FG_CHECK_EVENTS_PATH (default
 * .fg/check-events.ndjson). Nonzero command exits are preserved; invalid CI
 * provenance evidence also fails the wrapper. Per-test exactness for vitest
 * comes from the in-process reporter each package's
 * `test` script is invoked with (see ci.yml), not from scraping this output.
 *
 * Used by .forgejo/workflows/ci.yml so ForgeGraph (and Bob's own cockpit,
 * via ForgeGraph's ci/gate) get typecheck ✓ · lint ✓ · test 57/58 ✗ for
 * every Bob build instead of a bare pass/fail.
 */
import {
  createCheckEventWriter,
  createPassthroughAdapter,
  runPhase,
} from "@forgegraph/check-events";

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { ciProvenance } from "./ci-deployable-gate.mjs";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const phase = args[0];
const command =
  sep === -1 ? args.slice(1).join(" ") : args.slice(sep + 1).join(" ");
const PHASES = new Set(["typecheck", "lint", "test", "e2e", "build"]);

if (!PHASES.has(phase) || !command) {
  console.error(
    "usage: ci-check-phase.mjs <typecheck|lint|test|e2e|build> -- <command...>",
  );
  process.exit(2);
}

// Each invocation owns a fresh summary directory; stale Turbo summaries can
// never become evidence for this phase, even on reused runner workspaces.
const evidenceDir = join(process.cwd(), ".turbo", "ci-evidence");
const summaryDir = join(process.cwd(), ".turbo", "runs");
const provenance = process.env.CI_CHECK_SHA ? ciProvenance() : null;
if (provenance) {
  mkdirSync(evidenceDir, { recursive: true });
  rmSync(join(evidenceDir, `${phase}.json`), { force: true });
  rmSync(summaryDir, { recursive: true, force: true });
}
const writer = createCheckEventWriter(
  process.cwd(),
  process.env.FG_CHECK_EVENTS_PATH,
);
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
// Keep the executed command's result in its receipt. The wrapper also owns
// verification of that receipt and must fail CI when evidence is incomplete.
let wrapperExitCode = result.exitCode;
if (provenance) {
  let tasks = [];
  let evidenceError = false;
  try {
    const files = readdirSync(summaryDir).filter((f) => f.endsWith(".json"));
    if (files.length !== 1)
      throw new Error("Expected exactly one Turbo summary");
    const summary = JSON.parse(
      readFileSync(join(summaryDir, files[0]), "utf8"),
    );
    if (!Array.isArray(summary.tasks) || summary.scm?.sha !== provenance.sha)
      throw new Error("Invalid summary provenance");
    tasks = summary.tasks;
  } catch {
    evidenceError = true;
    if (wrapperExitCode === 0) wrapperExitCode = 1;
    console.error(
      `Unable to verify fresh ${phase} Turbo evidence for CI SHA ${provenance.sha}`,
    );
  }
  const target = join(evidenceDir, `${phase}.json`);
  writeFileSync(
    `${target}.tmp`,
    JSON.stringify({
      ...provenance,
      phase,
      exitCode: result.exitCode,
      evidenceError,
      tasks,
    }),
  );
  renameSync(`${target}.tmp`, target);
}
process.exit(wrapperExitCode);
