import assert from "node:assert/strict";
import test from "node:test";

import { buildHostVerification, providerProbeCommands } from "./verify-bob-provider-host.mjs";

test("defines secrets-safe service-user probes for all four providers", () => {
  assert.deepEqual(Object.keys(providerProbeCommands), [
    "claude",
    "codex",
    "grok",
    "cursor-agent",
  ]);
  for (const probe of Object.values(providerProbeCommands)) {
    assert.match(probe, /^sudo -u bob -H /);
    assert.doesNotMatch(probe, /cat .*auth|printenv|API_KEY/);
  }
});

test("fails readiness when a provider is unauthenticated or heartbeat is stale", () => {
  const result = buildHostVerification({
    host: "hetzner-bob",
    serviceActive: true,
    heartbeatAgeSeconds: 180,
    providers: {
      claude: { installed: true, authenticated: true },
      codex: { installed: true, authenticated: true },
      grok: { installed: true, authenticated: false },
      "cursor-agent": { installed: true, authenticated: true },
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    "heartbeat is stale (180s)",
    "grok is not authenticated as the service user",
  ]);
});

test("passes only when service, heartbeat, and all providers are ready", () => {
  const ready = { installed: true, authenticated: true };
  assert.equal(buildHostVerification({
    host: "hetzner-bob",
    serviceActive: true,
    heartbeatAgeSeconds: 15,
    providers: { claude: ready, codex: ready, grok: ready, "cursor-agent": ready },
  }).ok, true);
});
