import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Every test file gets its own runner state. Without this a BobGatewayConnector
// built by a test journals into the live runner's ~/.bob-runner/event-buffer,
// and the next runner start replays those fixture frames to the gateway
// (BOB-64: a host-side release test run as the service user did exactly that).
const stateDir = mkdtempSync(join(tmpdir(), "ooda-runner-state-"));
process.env.BOB_RUNNER_BUFFER_DIR = join(stateDir, "event-buffer");
process.env.BOB_RUNNER_SUPERVISE_DIR = join(stateDir, "runs");

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});
