import { createHash } from "node:crypto";

import {
  getHermesIntentPolicy,
  parseHermesOperatorIntent,
  type HermesOperatorIntent,
} from "@gmacko/bob/contracts";
import type {
  HermesDailyBrief,
  HermesEveningClose,
} from "./hermes-briefing";

interface CaptureReceipt {
  schemaVersion: 1;
  requestId: string;
  replayed: boolean;
  canonicalRef: { kind: "conversation_event"; id: string };
  occurredAt: string;
}

interface OodaCaptureClient {
  capture(input: {
    schemaVersion: 1;
    requestId: string;
    conversationId: string;
    branchId: string;
    text: string;
    occurredAt: string;
  }): Promise<CaptureReceipt>;
}

function parseCaptureReceipt(value: unknown): CaptureReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OODA returned an invalid Hermes capture receipt");
  }
  const row = value as Record<string, unknown>;
  const canonicalRef = row.canonicalRef;
  if (
    Object.keys(row).sort().join("\0") !== [
      "canonicalRef",
      "occurredAt",
      "replayed",
      "requestId",
      "schemaVersion",
    ].sort().join("\0")
    || row.schemaVersion !== 1
    || typeof row.requestId !== "string"
    || typeof row.replayed !== "boolean"
    || typeof row.occurredAt !== "string"
    || !canonicalRef
    || typeof canonicalRef !== "object"
    || Array.isArray(canonicalRef)
    || Object.keys(canonicalRef).sort().join("\0") !== ["id", "kind"].join("\0")
    || (canonicalRef as Record<string, unknown>).kind !== "conversation_event"
    || typeof (canonicalRef as Record<string, unknown>).id !== "string"
  ) {
    throw new Error("OODA returned an invalid Hermes capture receipt");
  }
  return value as CaptureReceipt;
}

export function createOodaHermesCaptureClient(config: {
  origin: string;
  apiKey: string;
  fetch?: typeof fetch;
}): OodaCaptureClient {
  const originUrl = new URL(config.origin);
  if (
    originUrl.protocol !== "https:"
    || originUrl.username
    || originUrl.password
    || originUrl.search
    || originUrl.hash
  ) {
    throw new Error("OODA origin must be an explicit HTTPS URL");
  }
  if (!config.apiKey.trim()) throw new Error("OODA owner-scoped API key is required");
  const endpoint = new URL("/api/v1/hermes/capture", originUrl).toString();
  const fetchImpl = config.fetch ?? fetch;
  return {
    async capture(input) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(`OODA Hermes capture returned ${response.status}`);
      return parseCaptureReceipt(await response.json());
    },
  };
}

export interface HermesUsageRecord {
  requestIdDigest: string;
  intent: HermesOperatorIntent["intent"];
  channel: HermesOperatorIntent["channel"];
  owner: "ooda" | "bob" | "skillfleet";
  riskClass: "R0" | "R1" | "R2" | "R3" | "R4";
  outcome: "success" | "failure" | "cancelled" | "blocked" | "replayed" | "policy_rejected";
  durationBucket: "<1s" | "1-10s" | "10-60s" | "1-5m" | ">5m" | "unknown";
  evidence: "complete" | "partial" | "unknown";
  observedAt: string;
}

export function createHermesUsageJournalRecord(value: HermesUsageRecord) {
  const canonical = JSON.stringify([
    value.requestIdDigest,
    value.intent,
    value.channel,
    value.owner,
    value.riskClass,
    value.outcome,
    value.durationBucket,
    value.evidence,
    value.observedAt,
  ]);
  return {
    schemaVersion: 1 as const,
    recordId: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    source: "bob" as const,
    observedAt: value.observedAt,
    sessionIdDigest: null,
    projectIdDigest: null,
    provenanceQuality: "direct" as const,
    kind: "hermes_usage" as const,
    payload: {
      requestIdDigest: value.requestIdDigest,
      intent: value.intent,
      channel: value.channel,
      owner: value.owner,
      riskClass: value.riskClass,
      outcome: value.outcome,
      durationBucket: value.durationBucket,
      evidence: value.evidence,
    },
  };
}

export function createHermesJournalUsageSink(dependencies: {
  append(line: string): Promise<void>;
}) {
  return {
    record(value: HermesUsageRecord): Promise<void> {
      return dependencies.append(`${JSON.stringify(createHermesUsageJournalRecord(value))}\n`);
    },
  };
}

interface HermesOperatorDependencies {
  ooda: OodaCaptureClient;
  usage: { record(value: HermesUsageRecord): Promise<void> };
  conversation: { id: string; branchId: string };
  digestRequestId(requestId: string): string;
  now?: () => Date;
  briefing?: {
    today(): Promise<HermesDailyBrief>;
    close(): Promise<HermesEveningClose>;
  };
  status?: {
    read(query: string): Promise<{
      summary: string;
      canonicalRef: { kind: string; id: string; href?: string };
      observedAt: string;
      coverage: "complete" | "partial" | "unknown";
    }>;
  };
}

function durationBucket(durationMs: number): HermesUsageRecord["durationBucket"] {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  if (durationMs < 1_000) return "<1s";
  if (durationMs < 10_000) return "1-10s";
  if (durationMs < 60_000) return "10-60s";
  if (durationMs < 300_000) return "1-5m";
  return ">5m";
}

export function createHermesOperatorService(
  dependencies: HermesOperatorDependencies,
) {
  return {
    async handle(input: unknown) {
      const intent = parseHermesOperatorIntent(input);
      const policy = getHermesIntentPolicy(intent.intent, intent.channel);
      const now = dependencies.now?.() ?? new Date();
      const elapsed = now.getTime() - Date.parse(intent.occurredAt);
      const usageBase = {
        requestIdDigest: dependencies.digestRequestId(intent.requestId),
        intent: intent.intent,
        channel: intent.channel,
        owner: policy.owner,
        riskClass: policy.riskClass,
        durationBucket: durationBucket(elapsed),
        observedAt: now.toISOString(),
      } as const;

      const supported = intent.intent === "capture"
        || (intent.intent === "today" && dependencies.briefing)
        || (intent.intent === "close" && dependencies.briefing)
        || (intent.intent === "status" && dependencies.status);
      if (!supported) {
        await dependencies.usage.record({
          ...usageBase,
          outcome: "blocked",
          evidence: "unknown",
        });
        throw new Error(`Hermes intent ${intent.intent} is not implemented by this service`);
      }

      let completed: {
        response: unknown;
        outcome: "success" | "replayed";
        evidence: "complete" | "partial" | "unknown";
      };
      try {
        if (intent.intent === "capture") {
          const receipt = await dependencies.ooda.capture({
            schemaVersion: 1,
            requestId: intent.requestId,
            conversationId: dependencies.conversation.id,
            branchId: dependencies.conversation.branchId,
            text: intent.payload.text,
            occurredAt: intent.occurredAt,
          });
          completed = {
            outcome: receipt.replayed ? "replayed" : "success",
            evidence: "complete",
            response: {
              schemaVersion: 1 as const,
              intent: "capture.receipt" as const,
              riskClass: policy.riskClass,
              summary: receipt.replayed ? "Capture already exists in OODA." : "Captured in OODA.",
              owner: policy.owner,
              canonicalRef: receipt.canonicalRef,
              freshness: { observedAt: receipt.occurredAt, coverage: "complete" as const },
              approval: { required: false as const },
            },
          };
        } else if (intent.intent === "today") {
          const brief = await dependencies.briefing!.today();
          const coverage = brief.gaps.length === 0 ? "complete" : "partial";
          completed = {
            outcome: "success",
            evidence: coverage,
            response: {
              schemaVersion: 1 as const,
              intent: "today.brief" as const,
              riskClass: policy.riskClass,
              summary: "Morning brief assembled from canonical sources.",
              owner: policy.owner,
              canonicalRef: { kind: "briefing", id: `morning:${brief.generatedAt.slice(0, 10)}` },
              freshness: { observedAt: brief.generatedAt, coverage },
              approval: { required: false as const },
              data: brief,
            },
          };
        } else if (intent.intent === "status") {
          const status = await dependencies.status!.read(intent.payload.query);
          completed = {
            outcome: "success",
            evidence: status.coverage,
            response: {
              schemaVersion: 1 as const,
              intent: "status.result" as const,
              riskClass: policy.riskClass,
              summary: status.summary,
              owner: policy.owner,
              canonicalRef: status.canonicalRef,
              freshness: { observedAt: status.observedAt, coverage: status.coverage },
              approval: { required: false as const },
            },
          };
        } else {
          const close = await dependencies.briefing!.close();
          completed = {
            outcome: "success",
            evidence: "complete",
            response: {
              schemaVersion: 1 as const,
              intent: "close.summary" as const,
              riskClass: policy.riskClass,
              summary: "Evening close assembled from canonical evidence and proposals.",
              owner: policy.owner,
              canonicalRef: { kind: "briefing", id: `evening:${close.generatedAt.slice(0, 10)}` },
              freshness: { observedAt: close.generatedAt, coverage: "complete" as const },
              approval: { required: false as const },
              data: close,
            },
          };
        }
      } catch (error) {
        await dependencies.usage.record({
          ...usageBase,
          outcome: "failure",
          evidence: "unknown",
        });
        throw error;
      }
      await dependencies.usage.record({
        ...usageBase,
        outcome: completed.outcome,
        evidence: completed.evidence,
      });
      return completed.response;
    },
  };
}
