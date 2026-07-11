#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const providerProbeCommands = {
  claude: "sudo -u bob -H sh -lc 'command -v claude >/dev/null && claude auth status >/dev/null 2>&1'",
  codex: "sudo -u bob -H sh -lc 'command -v codex >/dev/null && codex login status >/dev/null 2>&1'",
  grok: "sudo -u bob -H sh -lc 'command -v grok >/dev/null && grok models >/dev/null 2>&1'",
  "cursor-agent": "sudo -u bob -H sh -lc 'command -v cursor-agent >/dev/null && cursor-agent status >/dev/null 2>&1'",
};

export function buildHostVerification(input) {
  const failures = [];
  if (!input.serviceActive) failures.push("bob-execution.service is not active");
  if (!Number.isFinite(input.heartbeatAgeSeconds) || input.heartbeatAgeSeconds > 90) {
    failures.push(`heartbeat is stale (${input.heartbeatAgeSeconds}s)`);
  }
  for (const provider of Object.keys(providerProbeCommands)) {
    const state = input.providers[provider];
    if (!state?.installed) failures.push(`${provider} is not installed for the service user`);
    else if (!state.authenticated) failures.push(`${provider} is not authenticated as the service user`);
  }
  return { ...input, ok: failures.length === 0, failures };
}

function remoteBoolean(target, command) {
  try {
    execFileSync("ssh", [target, command], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

function verifyRemote(host, user) {
  const target = `${user}@${host}`;
  const providers = {};
  for (const [provider, probe] of Object.entries(providerProbeCommands)) {
    const installed = remoteBoolean(target, `sudo -u bob -H sh -lc 'command -v ${provider} >/dev/null'`);
    providers[provider] = {
      installed,
      authenticated: installed && remoteBoolean(target, probe),
    };
  }
  const serviceActive = remoteBoolean(target, "systemctl is-active --quiet bob-execution.service");
  const heartbeatAgeSeconds = remoteBoolean(
    target,
    "journalctl -u bob-execution.service --since '-90 seconds' --no-pager -o cat | grep -Eq 'Authenticated|Connected'",
  ) ? 0 : Number.POSITIVE_INFINITY;
  return buildHostVerification({ host, serviceActive, heartbeatAgeSeconds, providers });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifyRemote(process.argv[2] ?? "hetzner-bob", process.argv[3] ?? "root");
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
