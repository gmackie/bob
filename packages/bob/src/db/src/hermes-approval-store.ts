import { eq } from "drizzle-orm";

import type { Db } from "./client.js";
import { hermesApprovalConsumptions } from "./hermes-schema.js";

const HERMES_OWNERS = new Set(["ooda", "bob", "skillfleet", "forgegraph"]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export interface HermesApprovalConsumption {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly owner: "ooda" | "bob" | "skillfleet" | "forgegraph";
  readonly scopeDigest: string;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly consumedAt: string;
  readonly expiresAt: string;
}

export class HermesApprovalAlreadyConsumedError extends Error {
  readonly name = "HermesApprovalAlreadyConsumedError";

  constructor(readonly approvalId: string) {
    super(`Hermes approval has already been consumed: ${approvalId}`);
  }
}

function parseConsumption(
  input: HermesApprovalConsumption,
): HermesApprovalConsumption {
  const identifierFields = [
    input.approvalId,
    input.proposalId,
    input.executionId,
    input.idempotencyKey,
  ];
  if (
    identifierFields.some((value) => value.length < 1 || value.length > 256)
  ) {
    throw new Error(
      "Hermes approval consumption contains an invalid identifier",
    );
  }
  if (!HERMES_OWNERS.has(input.owner)) {
    throw new Error("Hermes approval consumption contains an invalid owner");
  }
  if (!SHA256_DIGEST.test(input.scopeDigest)) {
    throw new Error(
      "Hermes approval consumption contains an invalid scope digest",
    );
  }
  const consumedAt = Date.parse(input.consumedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(consumedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= consumedAt
  ) {
    throw new Error(
      "Hermes approval consumption is outside its validity window",
    );
  }
  return input;
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString().replace(".000Z", "Z");
}

export function createHermesApprovalLedger(db: Db) {
  return {
    async consume(
      input: HermesApprovalConsumption,
    ): Promise<HermesApprovalConsumption> {
      const consumption = parseConsumption(input);
      const inserted = await db
        .insert(hermesApprovalConsumptions)
        .values(consumption)
        .onConflictDoNothing()
        .returning({ approvalId: hermesApprovalConsumptions.approvalId });
      if (inserted.length === 0) {
        throw new HermesApprovalAlreadyConsumedError(consumption.approvalId);
      }
      return consumption;
    },

    async find(approvalId: string): Promise<HermesApprovalConsumption | null> {
      const rows = await db
        .select()
        .from(hermesApprovalConsumptions)
        .where(eq(hermesApprovalConsumptions.approvalId, approvalId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        ...row,
        owner: row.owner as HermesApprovalConsumption["owner"],
        consumedAt: normalizeTimestamp(row.consumedAt),
        expiresAt: normalizeTimestamp(row.expiresAt),
      };
    },
  };
}
