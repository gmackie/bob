import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { oodaSchema } from "./conversations";

/**
 * Ledger of paid music generations (Lyria). Rows are reserved before the
 * provider call so the daily cap and idempotency keys hold even when the
 * caller disconnects; audio itself is returned inline and never stored.
 */
export const musicGenerations = oodaSchema.table(
  "music_generations",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerId: t.text().notNull(),
    idempotencyKey: t.text().notNull(),
    model: t.varchar({ length: 64 }).notNull(),
    promptSha256: t.varchar({ length: 64 }).notNull(),
    status: t.varchar({ length: 16 }).notNull(),
    costUsdMicros: t.integer().notNull(),
    errorCode: t.varchar({ length: 64 }),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [
    uniqueIndex("music_generations_owner_idempotency_uidx").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    index("music_generations_created_idx").on(t.createdAt),
  ],
);
