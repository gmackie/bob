import { createHmac } from "node:crypto";

import type { HermesUsageEvent } from "@bob/db";

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
}

interface HermesOperatorRuntimeDependencies {
  usage: { record(event: HermesUsageEvent): Promise<void> };
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

  return {
    authorize(auth: HermesOperatorRouteAuth): boolean {
      return auth.userId === ownerUserId;
    },
    createService(auth: HermesOperatorRouteAuth) {
      const actorUserIdDigest = digest("actor", auth.userId);
      return createHermesOperatorService({
        ooda,
        conversation,
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
