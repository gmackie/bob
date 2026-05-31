alter table "tenants"
  add column if not exists "stripe_customer_id" text,
  add column if not exists "stripe_subscription_id" text,
  add column if not exists "stripe_price_id" text,
  add column if not exists "stripe_product_id" text;

create unique index if not exists "tenants_stripe_customer_idx"
  on "tenants" ("stripe_customer_id")
  where "stripe_customer_id" is not null;

create unique index if not exists "tenants_stripe_subscription_idx"
  on "tenants" ("stripe_subscription_id")
  where "stripe_subscription_id" is not null;
