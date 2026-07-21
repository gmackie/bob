import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./auth.js";

// Backing table for the better-auth `sso` plugin (model `ssoProvider`,
// pluralized to `ssoProviders` by usePlural). Holds admin-registered OIDC/SAML
// identity providers so a tenant owner can bring their own IdP without a code
// change. oidcConfig/samlConfig are JSON blobs the plugin (de)serializes;
// domain drives email-domain → provider matching. PK is `text` to match
// better-auth's ID generator (like users/sessions).
export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    organizationId: text("organization_id"),
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    providerIdIdx: uniqueIndex("sso_providers_provider_id_idx").on(table.providerId),
    domainIdx: index("sso_providers_domain_idx").on(table.domain),
    userIdx: index("sso_providers_user_idx").on(table.userId),
  }),
);

export const ssoProvidersInsertSchema = createInsertSchema(ssoProviders);
export const ssoProvidersSelectSchema = createSelectSchema(ssoProviders);

export type SsoProvider = typeof ssoProviders.$inferSelect;
export type NewSsoProvider = typeof ssoProviders.$inferInsert;
