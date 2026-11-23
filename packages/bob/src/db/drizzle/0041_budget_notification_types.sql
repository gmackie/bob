-- BOB-76: subscription budget alerts. They push by default like the proxy
-- outage alerts: a subscription about to waste its week, or Bob eating the
-- reserve held for interactive use, both need a person to look.
--
-- ADD VALUE is safe inside a transaction on PostgreSQL 12+ as long as the new
-- value is not used in the same transaction, which this migration does not do.
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'budget_projected_miss';
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'budget_reserve_breach';
