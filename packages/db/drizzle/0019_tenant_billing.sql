ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_status" text;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_customer_id_idx"
  ON "tenants" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_subscription_id_idx"
  ON "tenants" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;
