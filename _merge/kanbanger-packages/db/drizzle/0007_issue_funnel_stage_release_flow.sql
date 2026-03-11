ALTER TYPE issue_funnel_stage ADD VALUE IF NOT EXISTS 'staging_deployed';

ALTER TYPE issue_funnel_stage ADD VALUE IF NOT EXISTS 'staging_verified';

ALTER TYPE issue_funnel_stage ADD VALUE IF NOT EXISTS 'production_deployed';
