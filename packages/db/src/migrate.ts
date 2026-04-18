import { getDb } from "./client";

export async function migrate() {
  const db = await getDb();
  // Use raw SQL since drizzle-kit doesn't support PGlite directly
  await db.execute(`
    DO $$ BEGIN
      CREATE TYPE thread_status AS ENUM ('active', 'paused', 'archived', 'completed');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS thread (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(256) NOT NULL,
      status thread_status NOT NULL DEFAULT 'active',
      active_branch_id UUID,
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS branch (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      parent_branch_id UUID,
      fork_point_message_id UUID,
      name VARCHAR(256) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS message (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
      parent_id UUID,
      role message_role NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  console.log("Schema migrated successfully");
}

// Allow running directly via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
