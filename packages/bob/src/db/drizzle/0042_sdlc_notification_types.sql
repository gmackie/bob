-- BOB-81 (BOB-75 Phase 4): SDLC alerts. An SDLC item waiting on a person's
-- answer, ready for review, or failed; they push by default like a blocked
-- agent does, since each needs a person to look.
--
-- ADD VALUE is safe inside a transaction on PostgreSQL 12+ as long as the new
-- value is not used in the same transaction, which this migration does not do.
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'sdlc_waiting_input';
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'sdlc_review';
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'sdlc_failed';
