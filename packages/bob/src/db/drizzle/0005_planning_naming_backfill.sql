UPDATE "worktree_links"
SET "link_type" = 'planning_task'
WHERE "link_type" = 'kanbanger_task';

UPDATE "webhook_deliveries"
SET "provider" = 'planning'
WHERE "provider" = 'kanbanger';

UPDATE "webhook_deliveries"
SET "event_type" = 'planning_comment'
WHERE "event_type" = 'kanbanger_comment';

UPDATE "webhook_deliveries"
SET "event_type" = 'planning_comment_late'
WHERE "event_type" = 'kanbanger_comment_late';
