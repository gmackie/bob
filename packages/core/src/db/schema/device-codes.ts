import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./auth.js";
import { tenants } from "./tenancy.js";
import { apiKeys } from "./api-keys.js";

export const deviceFlowStatus = pgEnum("device_flow_status", [
  "pending",
  "approved",
  "denied",
  "consumed",
  "expired",
]);

export const deviceCodes = pgTable(
  "device_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCode: uuid("device_code").notNull().unique().defaultRandom(),
    userCode: varchar("user_code", { length: 16 }).notNull().unique(),
    status: deviceFlowStatus("status").notNull().default("pending"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusIdx: index("device_codes_status_idx").on(table.status),
  }),
);

export const deviceCodesInsertSchema = createInsertSchema(deviceCodes);
export const deviceCodesSelectSchema = createSelectSchema(deviceCodes);

export type DeviceCode = typeof deviceCodes.$inferSelect;
export type NewDeviceCode = typeof deviceCodes.$inferInsert;
