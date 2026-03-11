ALTER TYPE forge_deployment_status ADD VALUE IF NOT EXISTS "queued";

ALTER TYPE forge_deployment_status ADD VALUE IF NOT EXISTS "building";

ALTER TYPE forge_deployment_status ADD VALUE IF NOT EXISTS "testing";

ALTER TYPE forge_deployment_status ADD VALUE IF NOT EXISTS "verifying";
