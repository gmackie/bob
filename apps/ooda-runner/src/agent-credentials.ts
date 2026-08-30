/**
 * Agent credential reporting and browser-driven re-authentication.
 *
 * This lives here, rather than in the execution daemon it was first written
 * for, because ooda-runner is the process that actually holds the gateway
 * daemon connection on the host. The relay keeps one daemon per workspace, so
 * whichever process owns that slot must also own the credential surface — two
 * daemons would evict each other.
 *
 * The logic itself is imported from @bob/execution/providers so the runner, the
 * agent-health CLI, and the dashboard cannot form different opinions about
 * whether an agent is alive.
 *
 * ooda-runner runs as the user that owns ~/.claude and ~/.codex, so the vendor
 * CLI writes its own credentials exactly as it does over SSH. We relay a URL
 * out and a code back; no token passes through this process.
 */

import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";

import {
  AuthSessionManager,
  CreditLatch,
  FileCreditStore,
  probeCliProvider,
  providerIds,
} from "@bob/execution/providers";
import type { AuthPrompt, AuthPty, AuthResult, ProviderId } from "@bob/execution/providers";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_CACHE_MS = 5 * 60_000;

function runCommand(command: string, args: string[]) {
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

export interface AgentCredentialsOptions {
  hostId: string;
  daemonVersion: string;
  /** Sends a client message up the gateway socket. */
  send: (msg: Record<string, unknown>) => void;
  /** Current queue depth, for the host snapshot. */
  queueDepth: () => number;
  /**
   * Command runner for the probe. Injectable so tests are deterministic —
   * shelling out to the real CLIs makes them depend on the machine's own login
   * state and on network timing.
   */
  run?: typeof runCommand;
  /**
   * Whether the host's standalone task runner process is up. Optional because
   * the credential surface is useful without dispatch control; when it throws
   * the snapshot reports `undefined` rather than guessing, since the UI offers
   * a Start button off this field.
   */
  dispatchRunning?: () => Promise<boolean>;
}

export class AgentCredentials {
  /**
   * Durable so a restart cannot resurrect a broke agent as `ready`. The runner
   * restarts on failure, and an in-memory latch would clear on every bounce.
   */
  private readonly creditLatch = new CreditLatch(new FileCreditStore());
  private readonly auth: AuthSessionManager;
  private providerSnapshot: Awaited<ReturnType<typeof probeCliProvider>>[] = [];
  private lastProbeAt = 0;

  constructor(private readonly opts: AgentCredentialsOptions) {
    this.auth = new AuthSessionManager({
      spawn: (driver): AuthPty => {
        // Plain pipes, no PTY. Verified against the installed CLIs: every
        // device-auth flow prints its verification URL with stdio piped (grok
        // on stderr, codex and claude on stdout). Avoiding node-pty keeps this
        // free of native modules.
        const child = spawn(driver.command, driver.args, {
          cwd: process.env.HOME ?? homedir(),
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...driver.env, NO_COLOR: "1", TERM: "dumb" },
        });
        return {
          write: (data) => child.stdin.write(data),
          kill: () => {
            child.kill("SIGTERM");
          },
          onData: (cb) => {
            child.stdout.on("data", (d: Buffer) => cb(d.toString()));
            child.stderr.on("data", (d: Buffer) => cb(d.toString()));
          },
          onExit: (cb) => child.on("close", (code) => cb(code ?? 1)),
        };
      },
      onPrompt: (prompt: AuthPrompt) => {
        console.log(`[bob-gw] agent auth ${prompt.provider}: ${prompt.kind}`);
        this.opts.send({
          type: "agent_auth_prompt",
          requestId: prompt.requestId,
          provider: prompt.provider,
          kind: prompt.kind,
          url: prompt.url,
          code: prompt.code,
          instructions: prompt.instructions,
          tail: prompt.tail,
        });
      },
      onResult: (result: AuthResult) => {
        console.log(`[bob-gw] agent auth ${result.provider}: ${result.status}`);
        if (result.ok) {
          // Explicitly does NOT clear a credit latch — signing in again does
          // not buy credit, and clearing it here is what makes the UI say
          // "sign in" when it should say "top up".
          this.creditLatch.noteAuthSuccess(result.provider);
          void this.pushFreshSnapshot();
        }
        this.opts.send({
          type: "agent_auth_result",
          requestId: result.requestId,
          provider: result.provider,
          ok: result.ok,
          status: result.status,
          detail: result.detail,
        });
      },
    });
  }

  /** Probe every provider, honouring a short cache. */
  async hostSnapshot(force = false) {
    if (force || Date.now() - this.lastProbeAt > PROBE_CACHE_MS || !this.providerSnapshot.length) {
      // Re-read the shared latch file first. The agent-health CLI and the task
      // runner write to it from their own processes; without this the daemon
      // keeps serving whatever it loaded at startup, which is how the node
      // page went on reporting "Ready" for agents already latched as dead.
      this.creditLatch.reload();
      this.providerSnapshot = await Promise.all(
        providerIds.map((provider) =>
          probeCliProvider(
            provider,
            this.opts.run ?? runCommand,
            new Date(),
            this.creditLatch.get(provider),
          ),
        ),
      );
      this.lastProbeAt = Date.now();
    }
    return {
      schemaVersion: 1 as const,
      hostId: this.opts.hostId,
      daemonVersion: this.opts.daemonVersion,
      queueDepth: this.opts.queueDepth(),
      checkedAt: new Date().toISOString(),
      providers: this.providerSnapshot,
      dispatchRunning: await this.readDispatchRunning(),
    };
  }

  /** Undefined means "we could not tell", never "stopped". */
  private async readDispatchRunning(): Promise<boolean | undefined> {
    if (!this.opts.dispatchRunning) return undefined;
    try {
      return await this.opts.dispatchRunning();
    } catch {
      return undefined;
    }
  }

  private async pushFreshSnapshot(): Promise<void> {
    try {
      const hostSnapshot = await this.hostSnapshot(true);
      this.opts.send({ type: "ping", ts: new Date().toISOString(), hostSnapshot });
    } catch (error) {
      console.log(
        `[bob-gw] could not refresh host snapshot: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Feed a dispatch outcome to the credit latch. A 402 here latches for the
   * health CLI and the dashboard too; a success clears it. No probe can see an
   * exhausted balance, so this is the only path by which an agent that is
   * authenticated but broke is ever reported as anything other than ready.
   */
  noteRunOutcome(agentType: string, exitCode: number | null, output: string): void {
    const provider = providerIds.find((id) => id === agentType);
    if (!provider) return;
    this.creditLatch.noteRunOutcome(provider, {
      code: exitCode ?? 1,
      stderr: output.slice(-8_000),
    });
  }

  startAuth(requestId: string, provider: string): void {
    const known = providerIds.find((id) => id === provider);
    if (!known) {
      this.opts.send({
        type: "agent_auth_result",
        requestId,
        provider,
        ok: false,
        status: "failed",
        detail: `unknown provider ${provider}`,
      });
      return;
    }
    const outcome = this.auth.start(requestId, known as ProviderId);
    if (!outcome.ok) {
      this.opts.send({
        type: "agent_auth_result",
        requestId,
        provider: known,
        ok: false,
        status: "failed",
        detail: outcome.error ?? "could not start login",
      });
    }
  }

  submitCode(requestId: string, value: string): void {
    this.auth.submitCode(requestId, value);
  }

  cancelAuth(requestId: string): void {
    this.auth.cancel(requestId);
  }

  shutdown(): void {
    this.auth.shutdown();
  }
}
