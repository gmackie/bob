import type { Db } from "./client.js";
import { hermesUsageEvents } from "./hermes-schema.js";

export interface HermesUsageEvent {
  recordId: string;
  requestIdDigest: string;
  actorUserIdDigest: string;
  intent:
    | "today"
    | "capture"
    | "research"
    | "work"
    | "approve"
    | "status"
    | "fleet"
    | "close"
    | "stop";
  channel: "telegram" | "console" | "bob";
  owner: "ooda" | "bob" | "skillfleet" | "forgegraph";
  riskClass: "R0" | "R1" | "R2" | "R3" | "R4";
  outcome:
    | "success"
    | "failure"
    | "cancelled"
    | "blocked"
    | "replayed"
    | "policy_rejected";
  durationBucket: "<1s" | "1-10s" | "10-60s" | "1-5m" | ">5m" | "unknown";
  evidence: "complete" | "partial" | "unknown";
  observedAt: string;
}

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

function parseUsageEvent(event: HermesUsageEvent): HermesUsageEvent {
  if (
    !SHA256_DIGEST.test(event.recordId) ||
    !SHA256_DIGEST.test(event.requestIdDigest) ||
    !SHA256_DIGEST.test(event.actorUserIdDigest) ||
    !Number.isFinite(Date.parse(event.observedAt))
  ) {
    throw new Error("Hermes usage event contains invalid evidence identifiers");
  }
  for (const value of [
    event.intent,
    event.channel,
    event.owner,
    event.riskClass,
    event.outcome,
    event.durationBucket,
    event.evidence,
  ]) {
    if (value.length < 1 || value.length > 32) {
      throw new Error("Hermes usage event contains an invalid category");
    }
  }
  return event;
}

export function createHermesUsageStore(db: Db) {
  return {
    async record(event: HermesUsageEvent): Promise<void> {
      await db
        .insert(hermesUsageEvents)
        .values(parseUsageEvent(event))
        .onConflictDoNothing();
    },
  };
}
