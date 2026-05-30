import type { Db } from "@bob/db/client";
import { forgeRevisionAttestations } from "@bob/db/schema";

export interface ExecutionPolicy {
  requiredAttestations?: string[] | null;
}

export interface EnsureAttestationsInput {
  revisionId: string;
  repoId: string;
  taskId?: string | null;
  executionPolicy?: ExecutionPolicy | null;
}

function normalizeRequiredAttestations(
  executionPolicy?: ExecutionPolicy | null,
): string[] {
  const requiredAttestations = executionPolicy?.requiredAttestations;
  if (!Array.isArray(requiredAttestations)) return [];

  return Array.from(
    new Set(
      requiredAttestations
        .map((kind) => kind.trim())
        .filter((kind) => kind.length > 0),
    ),
  );
}

export async function ensureAttestations(
  db: Db,
  input: EnsureAttestationsInput,
): Promise<void> {
  const requiredAttestations = normalizeRequiredAttestations(
    input.executionPolicy,
  );
  if (requiredAttestations.length === 0) return;

  await db
    .insert(forgeRevisionAttestations)
    .values(
      requiredAttestations.map((kind) => ({
        revisionId: input.revisionId,
        repoId: input.repoId,
        taskId: input.taskId ?? null,
        kind,
        status: "pending",
      })),
    )
    .onConflictDoNothing({
      target: [
        forgeRevisionAttestations.revisionId,
        forgeRevisionAttestations.kind,
      ],
    });
}
