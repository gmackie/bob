import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tenants } from "./tenancy.js";

export const personaSource = pgEnum("persona_source", ["repo", "ui"]);

export const agentPersonas = pgTable(
  "agent_personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
    description: text("description"),
    adapterId: varchar("adapter_id", { length: 128 }).notNull(),
    model: varchar("model", { length: 80 }),

    systemPrompt: text("system_prompt"),
    allowedTools: jsonb("allowed_tools").$type<string[]>(),

    autonomyLevel: varchar("autonomy_level", { length: 32 }),
    budgetLimitCents: integer("budget_limit_cents"),

    source: personaSource("source").notNull().default("ui"),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSlugUnique: unique("agent_personas_tenant_slug_unique").on(
      table.tenantId,
      table.slug,
    ),
    tenantActiveIdx: index("agent_personas_tenant_active_idx").on(
      table.tenantId,
      table.active,
    ),
  }),
);

export const agentPersonasInsertSchema = createInsertSchema(agentPersonas);
export const agentPersonasSelectSchema = createSelectSchema(agentPersonas);

export type AgentPersona = typeof agentPersonas.$inferSelect;
export type NewAgentPersona = typeof agentPersonas.$inferInsert;
