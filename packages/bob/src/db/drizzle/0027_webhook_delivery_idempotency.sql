-- Make inbound webhook delivery claims atomic across concurrent Worker isolates.
-- PostgreSQL permits multiple NULL delivery IDs; only provider-addressable
-- deliveries participate in the replay boundary.
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_provider_delivery_unique"
  ON "webhook_deliveries" ("provider", "delivery_id")
  WHERE "delivery_id" IS NOT NULL;
