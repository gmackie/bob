/**
 * Repo-versioned replacement for /opt/bob/scripts/agent-health.js.
 *
 * That script existed only on the host: unreviewable, undeployable from this
 * repo, and free to disagree with the daemon about whether an agent was alive.
 * The task runner shelled out to it on every claim. This entry point is built
 * from the same probe the daemon uses and reads the same durable credit latch,
 * so the runner and the UI are structurally incapable of disagreeing.
 *
 *   node agent-health.js                 # all providers + dispatch decision
 *   node agent-health.js --agent grok    # one provider
 *   node agent-health.js --agent grok --quiet
 *   node agent-health.js --override      # decide as if the breaker were off
 *
 *   # Record a dispatch outcome (agent output on stdin). The task runner uses
 *   # this so 402s it observes latch in the same place the daemon's do, rather
 *   # than each process growing its own copy of the classifier.
 *   node agent-health.js --note-outcome --agent grok --exit-code 1 < run.log
 *
 * The report also carries the dispatch decision (see providers/dispatch-gate),
 * so the runner consumes a verdict rather than re-deriving one and drifting.
 *
 * Exit code is 0 when every requested provider is `ready`, 1 otherwise, so it
 * is usable as a shell guard as well as a JSON source.
 */

import { execFile } from "node:child_process";

import { probeCliProvider } from "./providers/cli-provider.js";
import type { ProviderId } from "./providers/contract.js";
import { providerIds } from "./providers/contract.js";
import { FileCreditStore } from "./providers/credit-store.js";
import { decideDispatch } from "./providers/dispatch-gate.js";
import { CreditLatch } from "./providers/credit.js";

const PROBE_TIMEOUT_MS = 10_000;

function run(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error && "code" in error && error.code === "ENOENT") {
        reject(error instanceof Error ? error : new Error("command not found"));
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

function parseAgents(argv: string[]): ProviderId[] {
  const index = argv.indexOf("--agent");
  if (index === -1) return [...providerIds];
  const requested = argv[index + 1];
  if (!requested) return [...providerIds];
  const matched = providerIds.find((id) => id === requested);
  if (!matched) {
    process.stderr.write(`unknown agent: ${requested}\n`);
    process.exit(2);
  }
  return [matched];
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string | Buffer) => {
      data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function noteOutcome(argv: string[], latch: CreditLatch): Promise<void> {
  const [provider] = parseAgents(argv);
  if (!provider) process.exit(2);
  const flag = argv.indexOf("--exit-code");
  const code = flag === -1 ? 1 : Number(argv[flag + 1] ?? 1);
  const output = await readStdin();
  latch.noteRunOutcome(provider, {
    code: Number.isFinite(code) ? code : 1,
    stderr: output,
  });
  const state = latch.get(provider);
  process.stdout.write(`${JSON.stringify({ provider, ...state })}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const agents = parseAgents(argv);
  const latch = new CreditLatch(new FileCreditStore());

  if (argv.includes("--note-outcome")) {
    await noteOutcome(argv, latch);
    return;
  }

  const preference = (process.env.BOB_AGENT_PREFERENCE ?? "claude,codex,grok")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const agentReports = await Promise.all(
    agents.map(async (provider) => {
      const snapshot = await probeCliProvider(provider, run, new Date(), latch.get(provider));
      return {
        name: snapshot.provider,
        status: snapshot.status,
        installed: snapshot.installed,
        authenticated: snapshot.authenticated,
        version: snapshot.version,
        detail: snapshot.detail,
        latchedAt: latch.latchedAt(provider),
        checkedAt: snapshot.checkedAt,
      };
    }),
  );

  const report = {
    checkedAt: new Date().toISOString(),
    agents: agentReports,
    dispatch: decideDispatch(preference, agentReports, {
      override: argv.includes("--override") || process.env.BOB_DISPATCH_OVERRIDE === "1",
    }),
  };

  if (!argv.includes("--quiet")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  process.exit(report.agents.every((a) => a.status === "ready") ? 0 : 1);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
