/**
 * Drains CLIProxyAPI's usage queue into the token ledger and ships running
 * totals to the gateway (BOB-76).
 *
 * The queue pops records destructively and keeps them only ~60s by default, so
 * this polls well inside that window and treats a longer gap between
 * successful drains as possible data loss (`gapsOver45s`). The ledger is
 * spooled to disk after every drain, so a runner restart resumes where it
 * stopped; the spool holds no keys.
 *
 * Messages carry absolute totals. Only changes are sent normally, and the
 * last few hours are resent periodically, which repairs anything `send`
 * dropped while the socket was down.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { UsageLedger, type UsageLedgerState, type UsageQueueRecord } from "./usage-ledger";

export interface UsagePollerOptions {
  /** Proxy base URL (CLIPROXY_BASE_URL). */
  baseUrl: string;
  /** CLIPROXY_MANAGEMENT_KEY; without it the poller is inert. */
  managementKey?: string;
  /** This host's proxy API keys; requests made with them are Bob's. */
  bobApiKeys: readonly string[];
  spoolPath: string;
  send: (message: Record<string, unknown>) => void;
  isConnected: () => boolean;
  fetch?: typeof fetch;
  now?: () => Date;
  intervalMs?: number;
  batchSize?: number;
  maxBatchesPerTick?: number;
  resendEveryMs?: number;
  resendWindowMs?: number;
  timeoutMs?: number;
  log?: (line: Record<string, unknown>) => void;
}

const GAP_WARN_MS = 45_000;

export class UsagePoller {
  private readonly ledger: UsageLedger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private sentRevision = 0;
  private lastFullResendAt = 0;
  private lastDrainAt?: number;
  private lastError?: string;
  private gaps = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(private readonly options: UsagePollerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.ledger = this.loadSpool();
    // A restarted runner has not told this gateway connection anything yet.
    this.lastFullResendAt = 0;
  }

  private get enabled(): boolean {
    return Boolean(this.options.managementKey);
  }

  private loadSpool(): UsageLedger {
    const ledgerOptions = { bobApiKeys: this.options.bobApiKeys };
    try {
      const state = JSON.parse(readFileSync(this.options.spoolPath, "utf8")) as UsageLedgerState;
      return UsageLedger.restore(ledgerOptions, state);
    } catch {
      return new UsageLedger(ledgerOptions);
    }
  }

  private writeSpool(): void {
    const path = this.options.spoolPath;
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.ledger.toJSON()), { mode: 0o600 });
    renameSync(temp, path);
  }

  /** Pop every queued record. Returns how many were ingested. */
  async drain(): Promise<number> {
    if (!this.enabled) return 0;
    const base = this.options.baseUrl.replace(/\/+$/, "");
    const batchSize = this.options.batchSize ?? 500;
    const maxBatches = this.options.maxBatchesPerTick ?? 20;
    let total = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const response = await this.fetchImpl(`${base}/v0/management/usage-queue?count=${batchSize}`, {
        headers: { authorization: `Bearer ${this.options.managementKey}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      });
      if (!response.ok) throw new Error(`usage queue answered HTTP ${response.status}`);
      const records = (await response.json()) as UsageQueueRecord[] | null;
      const list = Array.isArray(records) ? records : [];
      this.ledger.ingest(list);
      total += list.length;
      if (list.length < batchSize) break;
    }
    return total;
  }

  /** One cycle: drain, spool, prune, and send what changed. Never throws. */
  async tick(): Promise<void> {
    if (!this.enabled) return;
    const now = this.now();
    try {
      const drained = await this.drain();
      if (this.lastDrainAt !== undefined && now.getTime() - this.lastDrainAt > GAP_WARN_MS) {
        this.gaps += 1;
        this.options.log?.({ step: "budget-usage", outcome: "gap", seconds: Math.round((now.getTime() - this.lastDrainAt) / 1000) });
      }
      this.lastDrainAt = now.getTime();
      this.lastError = undefined;
      this.ledger.prune(now);
      if (drained > 0) this.writeSpool();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "usage queue failed";
      this.options.log?.({ step: "budget-usage", outcome: "error", error: this.lastError });
    }
    this.flush(now);
  }

  private flush(now: Date): void {
    if (!this.options.isConnected()) return;
    const resendEvery = this.options.resendEveryMs ?? 600_000;
    const full = now.getTime() - this.lastFullResendAt >= resendEvery;
    let buckets;
    let sessions;
    if (full) {
      const cutoff = now.getTime() - (this.options.resendWindowMs ?? 3 * 3_600_000);
      buckets = this.ledger.buckets().filter((bucket) => Date.parse(bucket.hour) + 3_600_000 > cutoff);
      sessions = this.ledger.sessions().filter((session) => Date.parse(session.lastAt) > cutoff);
    } else {
      buckets = this.ledger.buckets({ since: this.sentRevision });
      sessions = this.ledger.sessions({ since: this.sentRevision });
    }
    const revision = this.ledger.revision();
    if (full) this.lastFullResendAt = now.getTime();
    if (buckets.length === 0 && sessions.length === 0) {
      this.sentRevision = revision;
      return;
    }
    this.options.send({ type: "budget_usage", buckets, sessions });
    this.sentRevision = revision;
  }

  status(): { lastDrainAt?: string; lastError?: string; gapsOver45s: number } {
    return {
      ...(this.lastDrainAt !== undefined ? { lastDrainAt: new Date(this.lastDrainAt).toISOString() } : {}),
      lastError: this.lastError,
      gapsOver45s: this.gaps,
    };
  }

  start(): void {
    if (!this.enabled || this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.tick();
      if (this.running) this.timer = setTimeout(loop, this.options.intervalMs ?? 15_000);
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
