import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./auth.js";

// Tenancy tables — gmacko-owned. Tenants are the isolation boundary for
// all user-scoped data (secrets, sessions, runner work). A single user
// (from better-auth's `users` table) can belong to multiple tenants via
// `tenant_members`.

export const tenantRole = pgEnum("tenant_role", ["owner", "admin", "member"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tenantRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("tenant_members_tenant_id_idx").on(table.tenantId),
    userIdIdx: index("tenant_members_user_id_idx").on(table.userId),
    uniqueMember: unique("tenant_members_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
  }),
);

// drizzle-zod schemas for RPC validation
export const tenantsInsertSchema = createInsertSchema(tenants);
export const tenantsSelectSchema = createSelectSchema(tenants);
export const tenantMembersInsertSchema = createInsertSchema(tenantMembers);
export const tenantMembersSelectSchema = createSelectSchema(tenantMembers);

// Row type exports
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
