import { and, count, eq, gte, inArray } from "drizzle-orm";

import type { db as database } from "../db/client";
import { musicGenerations } from "../db/schema/music";
import {
  generateLyriaSong,
  MUSIC_MODELS,
  MusicGenerationError,
  type LyriaSong,
  type MusicModelId,
} from "./lyria-music";
import { isUniqueViolation } from "./serialization";

type OodaDatabase = typeof database;

export type MusicLedgerRow = {
  id: string;
  status: "pending" | "succeeded" | "failed";
  promptSha256: string;
};

/** Persistence the generation flow needs; Drizzle in production, memory in tests. */
export type MusicLedger = {
  find(ownerId: string, idempotencyKey: string): Promise<MusicLedgerRow | null>;
  /** Paid or in-flight generations created at or after `since`, across all owners. */
  countSince(since: Date): Promise<number>;
  /** Returns null when the owner already used this idempotency key. */
  reserve(row: {
    ownerId: string;
    idempotencyKey: string;
    model: MusicModelId;
    promptSha256: string;
    costUsdMicros: number;
  }): Promise<MusicLedgerRow | null>;
  /** Re-arms a failed reservation for a retry with the same key. */
  retry(id: string): Promise<void>;
  complete(id: string, outcome: { status: "succeeded" | "failed"; errorCode?: string }): Promise<void>;
};

export type GenerateMusicInput = {
  model: MusicModelId;
  prompt: string;
  idempotencyKey: string;
};

export type GenerateMusicResult = LyriaSong & {
  id: string;
  model: MusicModelId;
  costUsd: number;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function generateMusic(
  ledger: MusicLedger,
  ownerId: string,
  input: GenerateMusicInput,
  options: {
    apiKey: string;
    dailyLimit: number;
    signal?: AbortSignal;
    now?: Date;
    fetch?: typeof fetch;
  },
): Promise<GenerateMusicResult> {
  const promptSha256 = await sha256(`${input.model}\n${input.prompt}`);
  const existing = await ledger.find(ownerId, input.idempotencyKey);
  if (existing && (existing.status !== "failed" || existing.promptSha256 !== promptSha256)) {
    // Audio is never stored, so a succeeded key cannot be replayed; refusing
    // it is what stops a client retry from paying twice.
    throw new MusicGenerationError(
      "MUSIC_IDEMPOTENCY_CONFLICT",
      existing.promptSha256 !== promptSha256
        ? "This idempotency key was already used for a different prompt"
        : `This idempotency key was already used (${existing.status}); use a new key to generate again`,
    );
  }

  const used = await ledger.countSince(startOfUtcDay(options.now ?? new Date()));
  if (used >= options.dailyLimit) {
    throw new MusicGenerationError(
      "MUSIC_DAILY_LIMIT_REACHED",
      `The daily limit of ${options.dailyLimit} songs has been reached`,
    );
  }

  const { costUsdMicros } = MUSIC_MODELS[input.model];
  let row = existing;
  if (row) {
    await ledger.retry(row.id);
  } else {
    row = await ledger.reserve({
      ownerId,
      idempotencyKey: input.idempotencyKey,
      model: input.model,
      promptSha256,
      costUsdMicros,
    });
    if (!row) {
      throw new MusicGenerationError(
        "MUSIC_IDEMPOTENCY_CONFLICT",
        "This idempotency key is already in use",
      );
    }
  }

  try {
    const song = await generateLyriaSong(
      { model: input.model, prompt: input.prompt },
      { apiKey: options.apiKey, signal: options.signal },
      options.fetch,
    );
    await ledger.complete(row.id, { status: "succeeded" });
    return { ...song, id: row.id, model: input.model, costUsd: costUsdMicros / 1_000_000 };
  } catch (error) {
    await ledger.complete(row.id, {
      status: "failed",
      errorCode: error instanceof MusicGenerationError ? error.code : "MUSIC_ABORTED",
    });
    throw error;
  }
}

export function createDrizzleMusicLedger(db: OodaDatabase): MusicLedger {
  const columns = {
    id: musicGenerations.id,
    status: musicGenerations.status,
    promptSha256: musicGenerations.promptSha256,
  };
  return {
    async find(ownerId, idempotencyKey) {
      const [row] = await db
        .select(columns)
        .from(musicGenerations)
        .where(
          and(
            eq(musicGenerations.ownerId, ownerId),
            eq(musicGenerations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return (row as MusicLedgerRow | undefined) ?? null;
    },
    async countSince(since) {
      const [row] = await db
        .select({ value: count() })
        .from(musicGenerations)
        .where(
          and(
            gte(musicGenerations.createdAt, since),
            inArray(musicGenerations.status, ["pending", "succeeded"]),
          ),
        );
      return row?.value ?? 0;
    },
    async reserve(input) {
      try {
        const [row] = await db
          .insert(musicGenerations)
          .values({ ...input, status: "pending" })
          .returning(columns);
        return (row as MusicLedgerRow | undefined) ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async retry(id) {
      await db
        .update(musicGenerations)
        .set({ status: "pending", errorCode: null, completedAt: null, createdAt: new Date() })
        .where(eq(musicGenerations.id, id));
    },
    async complete(id, outcome) {
      await db
        .update(musicGenerations)
        .set({
          status: outcome.status,
          errorCode: outcome.errorCode ?? null,
          completedAt: new Date(),
        })
        .where(eq(musicGenerations.id, id));
    },
  };
}
