import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 7,
  name: '007_rename_amazonq_to_kiro',
  description: 'Update CHECK constraints to replace amazon-q with kiro',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // SQLite doesn't support modifying CHECK constraints, so we need to recreate the tables

    // Step 1: Create new agent_instances table with updated constraint
    await run(`
      CREATE TABLE agent_instances_new (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        agent_type TEXT NOT NULL DEFAULT 'claude' CHECK (agent_type IN ('claude', 'codex', 'gemini', 'kiro', 'cursor-agent', 'opencode')),
        status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'error')),
        pid INTEGER,
        port INTEGER,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
      )
    `);

    // Step 2: Copy data from old table, converting 'amazon-q' to 'kiro'
    await run(`
      INSERT INTO agent_instances_new (
        id, repository_id, worktree_id, agent_type, status, pid, port, error_message,
        created_at, updated_at, last_activity
      )
      SELECT
        id, repository_id, worktree_id,
        CASE WHEN agent_type = 'amazon-q' THEN 'kiro' ELSE agent_type END as agent_type,
        status, pid, port, error_message,
        created_at, updated_at, last_activity
      FROM agent_instances
    `);

    // Step 3: Drop old table and rename new one
    await run('DROP TABLE agent_instances');
    await run('ALTER TABLE agent_instances_new RENAME TO agent_instances');

    // Step 4: Recreate indexes
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_repository_id ON agent_instances(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_worktree_id ON agent_instances(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_agent_type ON agent_instances(agent_type)');

    // Step 5: Recreate trigger
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_agent_instances_updated_at
        AFTER UPDATE ON agent_instances
      BEGIN
        UPDATE agent_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    // Step 6: Update worktrees table (recreate with new constraint)
    await run(`
      CREATE TABLE worktrees_new (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        preferred_agent TEXT DEFAULT 'claude'
        CHECK (preferred_agent IN ('claude', 'codex', 'gemini', 'kiro', 'cursor-agent', 'opencode')),
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    // Step 7: Copy worktrees data, converting 'amazon-q' to 'kiro'
    await run(`
      INSERT INTO worktrees_new (
        id, repository_id, path, branch, created_at, updated_at, preferred_agent
      )
      SELECT
        id, repository_id, path, branch, created_at, updated_at,
        CASE WHEN preferred_agent = 'amazon-q' THEN 'kiro' ELSE preferred_agent END as preferred_agent
      FROM worktrees
    `);

    // Step 8: Drop old worktrees table and rename new one
    await run('DROP TABLE worktrees');
    await run('ALTER TABLE worktrees_new RENAME TO worktrees');

    // Step 9: Recreate worktrees indexes and trigger
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_repository_id ON worktrees(repository_id)');
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_worktrees_updated_at
        AFTER UPDATE ON worktrees
      BEGIN
        UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    console.log('Migration 007: Successfully renamed amazon-q to kiro in CHECK constraints');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Reverse the migration by converting 'kiro' back to 'amazon-q'

    // Step 1: Create agent_instances table with old constraint
    await run(`
      CREATE TABLE agent_instances_old (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        agent_type TEXT NOT NULL DEFAULT 'claude' CHECK (agent_type IN ('claude', 'codex', 'gemini', 'amazon-q', 'cursor-agent', 'opencode')),
        status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'error')),
        pid INTEGER,
        port INTEGER,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
      )
    `);

    await run(`
      INSERT INTO agent_instances_old (
        id, repository_id, worktree_id, agent_type, status, pid, port, error_message,
        created_at, updated_at, last_activity
      )
      SELECT
        id, repository_id, worktree_id,
        CASE WHEN agent_type = 'kiro' THEN 'amazon-q' ELSE agent_type END as agent_type,
        status, pid, port, error_message,
        created_at, updated_at, last_activity
      FROM agent_instances
    `);

    await run('DROP TABLE agent_instances');
    await run('ALTER TABLE agent_instances_old RENAME TO agent_instances');

    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_repository_id ON agent_instances(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_worktree_id ON agent_instances(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_agent_type ON agent_instances(agent_type)');

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_agent_instances_updated_at
        AFTER UPDATE ON agent_instances
      BEGIN
        UPDATE agent_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    // Step 2: Recreate worktrees with old constraint
    await run(`
      CREATE TABLE worktrees_old (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        preferred_agent TEXT DEFAULT 'claude'
        CHECK (preferred_agent IN ('claude', 'codex', 'gemini', 'amazon-q', 'cursor-agent', 'opencode')),
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    await run(`
      INSERT INTO worktrees_old (
        id, repository_id, path, branch, created_at, updated_at, preferred_agent
      )
      SELECT
        id, repository_id, path, branch, created_at, updated_at,
        CASE WHEN preferred_agent = 'kiro' THEN 'amazon-q' ELSE preferred_agent END as preferred_agent
      FROM worktrees
    `);

    await run('DROP TABLE worktrees');
    await run('ALTER TABLE worktrees_old RENAME TO worktrees');

    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_repository_id ON worktrees(repository_id)');
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_worktrees_updated_at
        AFTER UPDATE ON worktrees
      BEGIN
        UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    console.log('Migration 007: Successfully reverted kiro back to amazon-q');
  }
};

export default migration;
