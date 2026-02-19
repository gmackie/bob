import { promisify } from "util";

import { Migration } from "./migration-interface.js";

const migration: Migration = {
  id: 11,
  name: "011_workspace_manager",
  description:
    "Add workspace manager tables for runs, idempotent operations, and event outbox",

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    await run(`
      CREATE TABLE IF NOT EXISTS workspace_runs (
        user_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        base_rev TEXT NOT NULL,
        head_rev TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('CREATED', 'MATERIALIZED', 'CODING', 'TESTING', 'FAILED', 'PASSED', 'PENDING_APPROVAL', 'INTEGRATED', 'ABANDONED')),
        test_status TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, run_id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS workspace_operations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        result_json TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE (user_id, run_id, operation, idempotency_key)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS workspace_events_outbox (
        event_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        run_id TEXT NOT NULL,
        rev_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        published_at TEXT,
        delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'published', 'failed')) DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_runs_user ON workspace_runs(user_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_runs_repository ON workspace_runs(repository_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_runs_status ON workspace_runs(status)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_runs_workspace ON workspace_runs(workspace_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_ops_user ON workspace_operations(user_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_ops_run ON workspace_operations(run_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_ops_status ON workspace_operations(status)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_events_user ON workspace_events_outbox(user_id)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_events_status ON workspace_events_outbox(delivery_status)",
    );
    await run(
      "CREATE INDEX IF NOT EXISTS idx_workspace_events_run ON workspace_events_outbox(run_id)",
    );

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_workspace_runs_updated_at
        AFTER UPDATE ON workspace_runs
      BEGIN
        UPDATE workspace_runs SET updated_at = datetime('now') WHERE user_id = NEW.user_id AND run_id = NEW.run_id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_workspace_operations_updated_at
        AFTER UPDATE ON workspace_operations
      BEGIN
        UPDATE workspace_operations SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    await run("DROP TRIGGER IF EXISTS update_workspace_operations_updated_at");
    await run("DROP TRIGGER IF EXISTS update_workspace_runs_updated_at");
    await run("DROP INDEX IF EXISTS idx_workspace_events_run");
    await run("DROP INDEX IF EXISTS idx_workspace_events_user");
    await run("DROP INDEX IF EXISTS idx_workspace_events_status");
    await run("DROP INDEX IF EXISTS idx_workspace_ops_status");
    await run("DROP INDEX IF EXISTS idx_workspace_ops_user");
    await run("DROP INDEX IF EXISTS idx_workspace_ops_run");
    await run("DROP INDEX IF EXISTS idx_workspace_runs_workspace");
    await run("DROP INDEX IF EXISTS idx_workspace_runs_status");
    await run("DROP INDEX IF EXISTS idx_workspace_runs_user");
    await run("DROP INDEX IF EXISTS idx_workspace_runs_repository");
    await run("DROP TABLE IF EXISTS workspace_events_outbox");
    await run("DROP TABLE IF EXISTS workspace_operations");
    await run("DROP TABLE IF EXISTS workspace_runs");
  },
};

export default migration;
