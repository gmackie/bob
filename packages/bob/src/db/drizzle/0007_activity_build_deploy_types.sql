-- Add build and deploy activity types to the work_item_activity_type enum
ALTER TYPE "work_item_activity_type" ADD VALUE IF NOT EXISTS 'build_status_changed';
ALTER TYPE "work_item_activity_type" ADD VALUE IF NOT EXISTS 'deploy_status_changed';
