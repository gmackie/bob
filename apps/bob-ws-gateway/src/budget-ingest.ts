/**
 * BOB-76: persist subscription budget telemetry sent by runner daemons.
 *
 * Messages are typed but not validated on the socket, so everything here is
 * re-checked field by field and rebuilt from known fields only: a daemon bug
 * (or a forged frame) can neither store a stray field such as an API key nor
 * write a partial oversized batch.
 */
import type { BobSessionInput, BudgetAccountInput, MeterAccountInput, SessionLinkInput, UsageBucketInput, upsertUsageBuckets } from "@bob/db";

/** The database handle the @bob/db budget store writes through. */
export type BudgetDb = Parameters<typeof upsertUsageBuckets>[0];
import type { HostSnapshotWire } from "@bob/ws";

export interface BudgetStore {
  upsertUsageBuckets(db: BudgetDb, input: { workspaceId: string; hostId: string; buckets: UsageBucketInput[] }): Promise<number>;
  upsertBobSessions(db: BudgetDb, input: { workspaceId: string; hostId: string; sessions: BobSessionInput[] }): Promise<number>;
  recordMeterSamples(db: BudgetDb, input: { workspaceId: string; hostId: string; accounts: MeterAccountInput[] }): Promise<number>;
  upsertBudgetAccounts(db: BudgetDb, input: { workspaceId: string; hostId: string; accounts: BudgetAccountInput[] }): Promise<number>;
  upsertSessionLinks(db: BudgetDb, input: { workspaceId: string; links: SessionLinkInput[] }): Promise<number>;
}

interface Scope {
  workspaceId: string;
  hostId: string;
}

const MAX_ROWS = 5_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
const counter = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const time = (value: unknown): string | undefined =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;

function tokens(value: unknown): UsageBucketInput["tokens"] | undefined {
  if (!isRecord(value)) return undefined;
  const out = {
    input: counter(value.input),
    output: counter(value.output),
    reasoning: counter(value.reasoning),
    cacheRead: counter(value.cacheRead),
    cacheCreation: counter(value.cacheCreation),
    total: counter(value.total),
  };
  return Object.values(out).every((n) => n !== undefined) ? (out as UsageBucketInput["tokens"]) : undefined;
}

function meters(value: unknown): MeterAccountInput["meters"] {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((meter) => {
    if (!isRecord(meter)) return [];
    const window = text(meter.window, 40);
    const observedAt = time(meter.observedAt);
    const usedPercent = typeof meter.usedPercent === "number" && Number.isFinite(meter.usedPercent) ? meter.usedPercent : undefined;
    if (!window || !observedAt || usedPercent === undefined) return [];
    const windowMinutes = counter(meter.windowMinutes);
    const resetsAt = time(meter.resetsAt);
    const status = text(meter.status, 40);
    return [{ window, usedPercent, observedAt, ...(windowMinutes !== undefined ? { windowMinutes } : {}), ...(resetsAt ? { resetsAt } : {}), ...(status ? { status } : {}) }];
  });
  return out.length ? out : undefined;
}

function bucketOf(value: unknown): UsageBucketInput | undefined {
  if (!isRecord(value)) return undefined;
  const hour = time(value.hour);
  const authIndex = text(value.authIndex);
  const provider = text(value.provider, 40);
  const model = text(value.model);
  const source = value.source === "bob" || value.source === "interactive" ? value.source : undefined;
  const requests = counter(value.requests);
  const failed = counter(value.failed);
  const t = tokens(value.tokens);
  if (!hour || !authIndex || !provider || !model || !source || requests === undefined || failed === undefined || !t) return undefined;
  return { hour, authIndex, provider, model, source, requests, failed, tokens: t };
}

function sessionOf(value: unknown): BobSessionInput | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = text(value.sessionId);
  const authIndex = text(value.authIndex);
  const provider = text(value.provider, 40);
  const model = text(value.model);
  const requests = counter(value.requests);
  const failed = counter(value.failed);
  const t = tokens(value.tokens);
  const firstAt = time(value.firstAt);
  const lastAt = time(value.lastAt);
  if (!sessionId || !authIndex || !provider || !model || requests === undefined || failed === undefined || !t || !firstAt || !lastAt) return undefined;
  const metersFirst = meters(value.metersFirst);
  const metersLast = meters(value.metersLast);
  return { sessionId, authIndex, provider, model, requests, failed, tokens: t, firstAt, lastAt, ...(metersFirst ? { metersFirst } : {}), ...(metersLast ? { metersLast } : {}) };
}

export async function ingestBudgetUsage(db: BudgetDb, store: BudgetStore, scope: Scope, message: { buckets?: unknown; sessions?: unknown; links?: unknown }): Promise<void> {
  const rawBuckets = Array.isArray(message.buckets) ? message.buckets : [];
  const rawSessions = Array.isArray(message.sessions) ? message.sessions : [];
  const rawLinks = Array.isArray(message.links) ? message.links : [];
  if (rawBuckets.length > MAX_ROWS || rawSessions.length > MAX_ROWS || rawLinks.length > MAX_ROWS) throw new Error("budget_usage has too many rows");
  const buckets = rawBuckets.map(bucketOf).filter((b): b is UsageBucketInput => b !== undefined);
  const sessions = rawSessions.map(sessionOf).filter((s): s is BobSessionInput => s !== undefined);
  if (buckets.length) await store.upsertUsageBuckets(db, { ...scope, buckets });
  if (sessions.length) await store.upsertBobSessions(db, { ...scope, sessions });
  const links = rawLinks.flatMap((value): SessionLinkInput[] => {
    if (!isRecord(value)) return [];
    const nativeSessionId = text(value.nativeSessionId, 128);
    const bobSessionId = text(value.bobSessionId, 128);
    const linkedAt = time(value.linkedAt);
    return nativeSessionId && bobSessionId && linkedAt ? [{ nativeSessionId, bobSessionId, linkedAt }] : [];
  });
  if (links.length) await store.upsertSessionLinks(db, { workspaceId: scope.workspaceId, links });
}

export async function ingestMeterSamples(db: BudgetDb, store: BudgetStore, scope: Scope, snapshot: HostSnapshotWire): Promise<void> {
  const accounts = (snapshot.proxy?.accounts ?? []).flatMap((account): MeterAccountInput[] => {
    const id = text(account.id);
    const provider = text(account.provider, 40);
    if (!id || !provider) return [];
    const accountMeters = meters(account.meters);
    const modelMeters: Record<string, NonNullable<MeterAccountInput["meters"]>> = {};
    for (const [model, list] of Object.entries(account.modelMeters ?? {}).slice(0, 50)) {
      const parsed = meters(list);
      if (parsed && text(model)) modelMeters[model] = parsed;
    }
    if (!accountMeters && Object.keys(modelMeters).length === 0) return [];
    const authIndex = text(account.ref?.authIndex);
    return [{ id, provider, ...(authIndex ? { ref: { authIndex } } : {}), ...(accountMeters ? { meters: accountMeters } : {}), ...(Object.keys(modelMeters).length ? { modelMeters } : {}) }];
  });
  if (accounts.length) await store.recordMeterSamples(db, { ...scope, accounts });
}

/** Latest state of every proxy account on the heartbeat, metered or not. */
export async function ingestAccountStates(db: BudgetDb, store: BudgetStore, scope: Scope, snapshot: HostSnapshotWire): Promise<void> {
  const statuses = new Set(["ready", "cooldown", "disabled", "error"]);
  const accounts = (snapshot.proxy?.accounts ?? []).slice(0, 200).flatMap((account): BudgetAccountInput[] => {
    const id = text(account.id);
    const provider = text(account.provider, 40);
    const label = text(account.label) ?? "account";
    const status = typeof account.status === "string" && statuses.has(account.status) ? account.status : undefined;
    if (!id || !provider || !status) return [];
    const authIndex = text(account.ref?.authIndex);
    const detail = text(account.detail, 300);
    return [{ id, provider, label, status, ...(detail ? { detail } : {}), ...(authIndex ? { ref: { authIndex } } : {}) }];
  });
  if (accounts.length) await store.upsertBudgetAccounts(db, { ...scope, accounts });
}
