import { index, uniqueIndex } from "drizzle-orm/pg-core";

import {
  conversationEvents,
  conversations,
  oodaSchema,
} from "./conversations";

export const ttsGrants = oodaSchema.table(
  "tts_grants",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerId: t.text().notNull(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    eventId: t
      .uuid()
      .notNull()
      .references(() => conversationEvents.id, { onDelete: "cascade" }),
    requestMode: t.varchar({ length: 16 }).notNull(),
    tokenHash: t.varchar({ length: 64 }).notNull(),
    idempotencyKey: t.text().notNull(),
    commandFingerprint: t.text().notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
    usedAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("tts_grants_token_hash_uidx").on(t.tokenHash),
    uniqueIndex("tts_grants_owner_idempotency_uidx").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    index("tts_grants_expires_unused_idx").on(t.expiresAt, t.usedAt),
    index("tts_grants_conversation_event_idx").on(
      t.conversationId,
      t.eventId,
    ),
  ],
);
