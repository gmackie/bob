import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { conversationEvents, conversations, oodaSchema } from "./conversations";

export const hostTurnExecutions = oodaSchema.table(
  "host_turn_executions",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerId: t.text().notNull(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userEventId: t
      .uuid()
      .notNull()
      .references(() => conversationEvents.id, { onDelete: "cascade" }),
    assistantEventId: t
      .uuid()
      .references(() => conversationEvents.id, { onDelete: "set null" }),
    idempotencyKey: t.text().notNull(),
    commandFingerprint: t.text().notNull(),
    status: t.varchar({ length: 32 }).notNull().default("running"),
    provider: t.varchar({ length: 32 }),
    model: t.varchar({ length: 256 }),
    providerResponseId: t.text(),
    fallback: t.jsonb().$type<Record<string, unknown>>(),
    errorCode: t.varchar({ length: 128 }),
    leaseExpiresAt: t.timestamp({ withTimezone: true }).notNull(),
    startedAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("host_turn_executions_user_event_uidx").on(t.userEventId),
    uniqueIndex("host_turn_executions_owner_idempotency_uidx").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    index("host_turn_executions_status_lease_idx").on(
      t.status,
      t.leaseExpiresAt,
    ),
    index("host_turn_executions_conversation_idx").on(t.conversationId),
  ],
);
