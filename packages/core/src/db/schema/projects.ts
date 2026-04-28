import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tenants } from "./tenancy.js";

// Shared project primitive. Owned by @gmacko/projects (Phase 6D). Bob and
// OODA extend this via their own downstream tables (workspace, ForgeGraph,
// vault, etc.) rather than widening this schema.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("projects_tenant_id_idx").on(table.tenantId),
    uniqueTenantSlug: unique("projects_tenant_slug_unique").on(
      table.tenantId,
      table.slug,
    ),
  }),
);

// drizzle-zod schemas for RPC validation
export const projectsInsertSchema = createInsertSchema(projects);
export const projectsSelectSchema = createSelectSchema(projects);

// Row type exports
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
