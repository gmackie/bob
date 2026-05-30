CREATE TABLE IF NOT EXISTS "forge_revision_attestations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revision_id" uuid NOT NULL REFERENCES "forge_revisions"("id") ON DELETE cascade,
  "repo_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE cascade,
  "task_id" uuid REFERENCES "work_items"("id") ON DELETE set null,
  "kind" text NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "forge_revision_attestations_revision_idx"
  ON "forge_revision_attestations" ("revision_id");

CREATE INDEX IF NOT EXISTS "forge_revision_attestations_repo_idx"
  ON "forge_revision_attestations" ("repo_id");

CREATE UNIQUE INDEX IF NOT EXISTS "forge_revision_attestations_revision_kind_idx"
  ON "forge_revision_attestations" ("revision_id", "kind");
