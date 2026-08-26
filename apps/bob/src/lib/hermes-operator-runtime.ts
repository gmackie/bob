import { createHmac } from "node:crypto";

import type { HermesUsageEvent } from "@bob/db";

import {
  buildHermesMorningBrief,
  type HermesBriefSnapshot,
  type HermesBriefSource,
  type HermesEveningClose,
} from "./hermes-briefing";
import {
  HERMES_BRIEFING_SOURCE_TIMEOUT_MS,
  readHermesBriefingSource,
} from "./hermes-briefing-timeout";
import {
  createHermesOperatorService,
  createHermesUsageJournalRecord,
  createOodaHermesCaptureClient,
} from "./hermes-operator";
import type { HermesOperatorRouteAuth } from "./hermes-operator-route";

export interface HermesOperatorRuntimeConfig {
  ownerUserId: string;
  oodaOrigin: string;
  oodaApiKey: string;
  conversationId: string;
  branchId: string;
  digestSecret: string;
  fetch?: typeof fetch;
  now?: () => Date;
  briefingTimeoutMs?: number;
}

interface HermesOperatorRuntimeDependencies {
  usage: { record(event: HermesUsageEvent): Promise<void> };
  statusReader?: {
    read(query: string): Promise<{
      summary: string;
      canonicalRef: { kind: string; id: string; href?: string };
      observedAt: string;
      coverage: "complete" | "partial" | "unknown";
    }>;
  };
  closeReader?: { read(): Promise<HermesEveningClose> };
  briefingSources?: Partial<
    Record<HermesBriefSource, { read(): Promise<HermesBriefSnapshot> }>
  >;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value;
}

export function createHermesOperatorRuntime(
  config: HermesOperatorRuntimeConfig,
  dependencies: HermesOperatorRuntimeDependencies,
) {
  const ownerUserId = required(config.ownerUserId, "ownerUserId");
  const digestSecret = required(config.digestSecret, "digestSecret");
  const digest = (kind: string, value: string) =>
    `sha256:${createHmac("sha256", digestSecret).update(`${kind}\0${value}`).digest("hex")}`;
  const ooda = createOodaHermesCaptureClient({
    origin: config.oodaOrigin,
    apiKey: config.oodaApiKey,
    fetch: config.fetch,
  });
  const conversation = {
    id: required(config.conversationId, "conversationId"),
    branchId: required(config.branchId, "branchId"),
  };
  const briefingReaders = Object.values(dependencies.briefingSources ?? {});
  const briefingTimeoutMs = config.briefingTimeoutMs
    ?? HERMES_BRIEFING_SOURCE_TIMEOUT_MS;
  if (!Number.isSafeInteger(briefingTimeoutMs) || briefingTimeoutMs < 1) {
    throw new Error("briefingTimeoutMs must be a positive integer");
  }

  return {
    authorize(auth: HermesOperatorRouteAuth): boolean {
      return auth.userId === ownerUserId;
    },
    createService(auth: HermesOperatorRouteAuth) {
      const actorUserIdDigest = digest("actor", auth.userId);
      return createHermesOperatorService({
        ooda,
        conversation,
        now: config.now,
        status: dependencies.statusReader,
        ...(briefingReaders.length > 0 || dependencies.closeReader
          ? {
              briefing: {
                ...(briefingReaders.length > 0
                  ? {
                      async today() {
                        const settled = await Promise.all(
                          briefingReaders.map((reader) =>
                            readHermesBriefingSource(
                              () => reader.read(),
                              briefingTimeoutMs,
                            )),
                        );
                        const snapshots = settled.filter(
                          (snapshot): snapshot is HermesBriefSnapshot => snapshot !== null,
                        );
                        return buildHermesMorningBrief(
                          snapshots,
                          config.now?.() ?? new Date(),
                        );
                      },
                    }
                  : {}),
                ...(dependencies.closeReader
                  ? { close: () => dependencies.closeReader!.read() }
                  : {}),
              },
            }
          : {}),
        digestRequestId: (requestId) =>
          digest("request", `${auth.userId}\0${requestId}`),
        usage: {
          async record(value) {
            const journal = createHermesUsageJournalRecord(value);
            await dependencies.usage.record({
              recordId: journal.recordId,
              requestIdDigest: journal.payload.requestIdDigest,
              actorUserIdDigest,
              intent: journal.payload.intent,
              channel: journal.payload.channel,
              owner: journal.payload.owner,
              riskClass: journal.payload.riskClass,
              outcome: journal.payload.outcome,
              durationBucket: journal.payload.durationBucket,
              evidence: journal.payload.evidence,
              observedAt: journal.observedAt,
            });
          },
        },
      });
    },
  };
}
