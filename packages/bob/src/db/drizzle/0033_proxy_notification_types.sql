-- Two notification types for machinery outages that stop every run: the
-- inference proxy unreachable, and a provider with no ready account on it.
-- They push by default (see @bob/notifications/preferences) like a blocked
-- agent does; the sparse notification_preferences rows let a person opt out.
--
-- ADD VALUE is safe inside a transaction on PostgreSQL 12+ as long as the new
-- value is not used in the same transaction, which this migration does not do.
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'proxy_unreachable';
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'provider_no_ready_accounts';
