import { and, eq, gt, isNull } from "drizzle-orm";

import type {
  CreateTtsGrantInputV1,
  CreateTtsGrantResultV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import {
  conversationEvents,
  conversations,
} from "../db/schema/conversations";
import { ttsGrants } from "../db/schema/voice";
import { mapEvent } from "./mappers";
import {
  OodaKernelProblem,
  idempotencyConflict,
  notFound,
} from "./problems";
import { isUniqueViolation, stableStringify } from "./serialization";
import { createTtsGrantToken, hashTtsGrantToken } from "./tts-grant-token";
import { resolveTtsSpeakable } from "./tts-policy";

type OodaDatabase = typeof database;

export type TtsGrantOptions = {
  baseUrl: string;
  grantSecret: string;
  sensitiveTtsEnabled?: boolean;
  now?: Date;
  ttlMs?: number;
};

function streamUrl(baseUrl: string, token: string): string {
  return new URL(
    `/api/v1/tts-streams/${encodeURIComponent(token)}`,
    baseUrl,
  ).toString();
}

function disclosureDenied(code: string): OodaKernelProblem {
  return new OodaKernelProblem(
    "TTS_DISCLOSURE_DENIED",
    403,
    `Text-to-speech disclosure was denied by policy (${code})`,
  );
}

async function replayGrant(
  row: typeof ttsGrants.$inferSelect,
  input: CreateTtsGrantInputV1,
  options: TtsGrantOptions,
): Promise<CreateTtsGrantResultV1> {
  if (row.commandFingerprint !== stableStringify(input)) {
    throw idempotencyConflict();
  }
  const token = await createTtsGrantToken(row.id, options.grantSecret);
  return {
    grantId: row.id,
    streamUrl: streamUrl(options.baseUrl, token),
    expiresAt: row.expiresAt.toISOString(),
    replayed: true,
  };
}

async function findReplay(
  db: OodaDatabase,
  ownerId: string,
  input: CreateTtsGrantInputV1,
  options: TtsGrantOptions,
): Promise<CreateTtsGrantResultV1 | null> {
  const [row] = await db
    .select()
    .from(ttsGrants)
    .where(
      and(
        eq(ttsGrants.ownerId, ownerId),
        eq(ttsGrants.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return row ? replayGrant(row, input, options) : null;
}

export async function createTtsGrant(
  db: OodaDatabase,
  ownerId: string,
  input: CreateTtsGrantInputV1,
  options: TtsGrantOptions,
): Promise<CreateTtsGrantResultV1> {
  const existing = await findReplay(db, ownerId, input, options);
  if (existing) return existing;

  const [source] = await db
    .select({ conversation: conversations, event: conversationEvents })
    .from(conversations)
    .innerJoin(
      conversationEvents,
      and(
        eq(conversationEvents.id, input.eventId),
        eq(conversationEvents.conversationId, conversations.id),
      ),
    )
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!source) throw notFound("Assistant event");

  const decision = resolveTtsSpeakable({
    event: mapEvent(source.event),
    ttsPolicy: source.conversation.ttsPolicy,
    requestMode: input.requestMode,
    sensitiveTtsEnabled: options.sensitiveTtsEnabled ?? false,
  });
  if (!decision.allowed) throw disclosureDenied(decision.code);

  const grantId = crypto.randomUUID();
  const token = await createTtsGrantToken(grantId, options.grantSecret);
  const tokenHash = await hashTtsGrantToken(token);
  const now = options.now ?? new Date();
  const ttlMs = Math.min(Math.max(options.ttlMs ?? 120_000, 1_000), 120_000);
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    const [row] = await db
      .insert(ttsGrants)
      .values({
        id: grantId,
        ownerId,
        conversationId: input.conversationId,
        eventId: input.eventId,
        requestMode: input.requestMode,
        tokenHash,
        idempotencyKey: input.idempotencyKey,
        commandFingerprint: stableStringify(input),
        expiresAt,
      })
      .returning();
    if (!row) throw new Error("TTS grant insert returned no row");
    return {
      grantId,
      streamUrl: streamUrl(options.baseUrl, token),
      expiresAt: row.expiresAt.toISOString(),
      replayed: false,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replay = await findReplay(db, ownerId, input, options);
    if (replay) return replay;
    throw error;
  }
}

export async function consumeTtsGrant(
  db: OodaDatabase,
  ownerId: string,
  token: string,
  options: Pick<TtsGrantOptions, "sensitiveTtsEnabled"> & { now?: Date } = {},
): Promise<{ text: string; grantId: string }> {
  const now = options.now ?? new Date();
  const tokenHash = await hashTtsGrantToken(token);
  const [grant] = await db
    .update(ttsGrants)
    .set({ usedAt: now })
    .where(
      and(
        eq(ttsGrants.tokenHash, tokenHash),
        eq(ttsGrants.ownerId, ownerId),
        isNull(ttsGrants.usedAt),
        gt(ttsGrants.expiresAt, now),
      ),
    )
    .returning();
  if (!grant) {
    throw new OodaKernelProblem(
      "TTS_GRANT_UNAVAILABLE",
      410,
      "The text-to-speech grant is invalid, expired, or already used",
    );
  }

  const [source] = await db
    .select({ conversation: conversations, event: conversationEvents })
    .from(conversations)
    .innerJoin(
      conversationEvents,
      and(
        eq(conversationEvents.id, grant.eventId),
        eq(conversationEvents.conversationId, grant.conversationId),
      ),
    )
    .where(
      and(
        eq(conversations.id, grant.conversationId),
        eq(conversations.ownerId, grant.ownerId),
      ),
    )
    .limit(1);
  if (!source) throw notFound("Assistant event");

  const decision = resolveTtsSpeakable({
    event: mapEvent(source.event),
    ttsPolicy: source.conversation.ttsPolicy,
    requestMode: grant.requestMode as "automatic" | "manual",
    sensitiveTtsEnabled: options.sensitiveTtsEnabled ?? false,
  });
  if (!decision.allowed) throw disclosureDenied(decision.code);
  return { text: decision.text, grantId: grant.id };
}
