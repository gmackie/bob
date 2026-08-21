export const HERMES_BRIEF_SOURCES = [
  "ooda",
  "bob",
  "skillfleet",
  "forgegraph",
] as const;

export type HermesBriefSource = (typeof HERMES_BRIEF_SOURCES)[number];
export type HermesCoverage = "complete" | "partial" | "unknown";

export interface HermesCanonicalRef {
  kind: string;
  id: string;
  href?: string;
}

export interface HermesBriefItem {
  label: string;
  canonicalRef: HermesCanonicalRef;
}

export interface HermesBriefSnapshot {
  source: HermesBriefSource;
  observedAt: string | null;
  coverage: HermesCoverage;
  total: number;
  items: readonly HermesBriefItem[];
}

export interface HermesBriefSection extends HermesBriefSnapshot {
  shown: number;
}

export interface HermesDailyBrief {
  schemaVersion: 1;
  kind: "morning" | "evening";
  generatedAt: string;
  sections: HermesBriefSection[];
  gaps: string[];
}

function missingSnapshot(source: HermesBriefSource): HermesBriefSnapshot {
  return {
    source,
    observedAt: null,
    coverage: "unknown",
    total: 0,
    items: [],
  };
}

function buildBrief(
  kind: HermesDailyBrief["kind"],
  snapshots: readonly HermesBriefSnapshot[],
  now: Date,
): HermesDailyBrief {
  const bySource = new Map<HermesBriefSource, HermesBriefSnapshot>();
  for (const snapshot of snapshots) {
    if (bySource.has(snapshot.source)) {
      throw new Error(`Duplicate Hermes brief source: ${snapshot.source}`);
    }
    if (!Number.isInteger(snapshot.total) || snapshot.total < snapshot.items.length) {
      throw new Error(`Invalid Hermes brief count for ${snapshot.source}`);
    }
    bySource.set(snapshot.source, snapshot);
  }

  const sections = HERMES_BRIEF_SOURCES.map((source): HermesBriefSection => {
    const snapshot = bySource.get(source) ?? missingSnapshot(source);
    return { ...snapshot, items: [...snapshot.items], shown: snapshot.items.length };
  });
  const gaps = sections.flatMap((section) => {
    if (section.coverage === "unknown") return [`${section.source} did not report`];
    if (section.coverage === "partial") {
      return [`${section.source} reported partial coverage`];
    }
    return [];
  });

  return {
    schemaVersion: 1,
    kind,
    generatedAt: now.toISOString(),
    sections,
    gaps,
  };
}

export function buildHermesMorningBrief(
  snapshots: readonly HermesBriefSnapshot[],
  now: Date = new Date(),
): HermesDailyBrief {
  return buildBrief("morning", snapshots, now);
}

export interface HermesEveningCloseInput {
  completed: readonly HermesBriefItem[];
  blocked: readonly HermesBriefItem[];
  waiting: readonly HermesBriefItem[];
  captured: readonly HermesBriefItem[];
  tomorrow: readonly HermesBriefItem[];
}

export interface HermesCloseItem extends HermesBriefItem {
  proposed: boolean;
}

export interface HermesEveningClose {
  schemaVersion: 1;
  kind: "evening";
  generatedAt: string;
  sections: Record<keyof HermesEveningCloseInput, HermesCloseItem[]>;
}

function closeItem(item: HermesBriefItem, proposed: boolean): HermesCloseItem {
  if (!item.label || !item.canonicalRef?.kind || !item.canonicalRef.id) {
    throw new Error("Hermes close item requires canonical evidence");
  }
  if (proposed && item.canonicalRef.kind !== "proposal") {
    throw new Error("Tomorrow close items must reference a proposal");
  }
  return { ...item, canonicalRef: { ...item.canonicalRef }, proposed };
}

export function buildHermesEveningClose(
  input: HermesEveningCloseInput,
  now: Date = new Date(),
): HermesEveningClose {
  return {
    schemaVersion: 1,
    kind: "evening",
    generatedAt: now.toISOString(),
    sections: {
      completed: input.completed.map((item) => closeItem(item, false)),
      blocked: input.blocked.map((item) => closeItem(item, false)),
      waiting: input.waiting.map((item) => closeItem(item, false)),
      captured: input.captured.map((item) => closeItem(item, false)),
      tomorrow: input.tomorrow.map((item) => closeItem(item, true)),
    },
  };
}

type HermesDeliverableBrief = HermesDailyBrief | HermesEveningClose;
type HermesBriefClaim = "new" | "retry" | "processed" | "pending" | "conflict";

export interface HermesBriefDeliveryLedger {
  claim(idempotencyKey: string, brief: HermesDeliverableBrief): Promise<HermesBriefClaim>;
  markProcessed(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, message: string): Promise<void>;
}

export interface HermesBriefScheduleRequest {
  idempotencyKey: string;
  name: string;
  scheduledFor: string;
  brief: HermesDeliverableBrief;
}

export interface HermesBriefDeliveryDependencies {
  ledger: HermesBriefDeliveryLedger;
  schedule(request: HermesBriefScheduleRequest): Promise<{ jobId: string }>;
  scheduledFor: string;
}

export async function deliverHermesDailyBrief(
  brief: HermesDeliverableBrief,
  dependencies: HermesBriefDeliveryDependencies,
): Promise<{ jobId?: string; deduplicated: boolean; pending?: boolean }> {
  const date = brief.generatedAt.slice(0, 10);
  const idempotencyKey = `hermes:${brief.kind}:${date}`;
  const claim = await dependencies.ledger.claim(idempotencyKey, brief);
  if (claim === "processed") return { deduplicated: true };
  if (claim === "pending") return { deduplicated: true, pending: true };
  if (claim === "conflict") {
    throw new Error(`Hermes brief idempotency conflict: ${idempotencyKey}`);
  }

  try {
    const result = await dependencies.schedule({
      idempotencyKey,
      name: idempotencyKey,
      scheduledFor: dependencies.scheduledFor,
      brief,
    });
    await dependencies.ledger.markProcessed(idempotencyKey);
    return { jobId: result.jobId, deduplicated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hermes brief delivery failed";
    await dependencies.ledger.markFailed(idempotencyKey, message.slice(0, 500));
    throw error;
  }
}
