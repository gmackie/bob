-- Billing / entitlements: link Stripe subscriptions to tenants.plan.

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM (
    'active',
    'trialing',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;

DO $$ BEGIN
  ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_stripe_customer_id_unique" UNIQUE ("stripe_customer_id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "stripe_subscription_id" text NOT NULL,
  "stripe_price_id" text NOT NULL,
  "status" "subscription_status" NOT NULL,
  "plan" "tenant_plan" NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "current_period_end" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_subscriptions_tenant_id_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "tenant_subscriptions_stripe_subscription_id_unique" UNIQUE ("stripe_subscription_id")
);

DO $$ BEGIN
  ALTER TABLE "tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
