#!/usr/bin/env node
/**
 * bob-check — thin launcher for the shared fg-check CLI
 * (@forgegraph/check-events, check-events v2).
 *
 * The shim name, path (./.bob/bin/bob-check), and events file are unchanged
 * so session prompts, SKILL.md instructions, and the worktree watcher's tail
 * all keep working. What changed underneath: detection now covers justfiles,
 * Makefiles, and forge-ci.toml; go test/TAP/TeamCity output streams exact
 * per-test events; vitest/jest keep the scrape fallback until repos adopt
 * the first-class reporters; and the run folds into a CTRF report.
 *
 * v1 events ({phase,status,counts}) and v2 events (event/test/counts) share
 * the file — consumers upgrade v1 lines on parse.
 */
process.env.FG_CHECK_EVENTS_PATH ??= ".bob/check-events.ndjson";

const { main } = await import("@forgegraph/check-events/cli");
process.exit(await main(process.argv.slice(2)));
