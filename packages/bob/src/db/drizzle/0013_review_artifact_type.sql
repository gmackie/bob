ALTER TYPE work_item_artifact_type ADD VALUE IF NOT EXISTS 'code_review';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_requested';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_approved';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_changes_requested';
