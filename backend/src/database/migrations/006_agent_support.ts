import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 6,
  name: '006_agent_support',
  description: 'Add multi-agent support by renaming claude_instances to agent_instances and adding agent_type column',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Step 1: Create new agent_instances table with agent_type column
    await run(`
      CREATE TABLE IF NOT EXISTS agent_instances (
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

    // Step 2: Copy data from claude_instances to agent_instances (if the old table exists)
    await run(`
      INSERT OR IGNORE INTO agent_instances (
        id, repository_id, worktree_id, agent_type, status, pid, port,
        created_at, updated_at, last_activity
      )
      SELECT
        id, repository_id, worktree_id, 'claude' as agent_type, status, pid, port,
        created_at, updated_at, last_activity
      FROM claude_instances
      WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='claude_instances')
    `);

    // Step 3: Drop the old claude_instances table
    await run('DROP TABLE IF EXISTS claude_instances');

    // Step 4: Add preferred_agent column to worktrees table
    await run(`
      ALTER TABLE worktrees ADD COLUMN preferred_agent TEXT DEFAULT 'claude'
      CHECK (preferred_agent IN ('claude', 'codex', 'gemini', 'kiro', 'cursor-agent', 'opencode'))
    `);

    // Step 5: Create indexes for the new table
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_repository_id ON agent_instances(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_worktree_id ON agent_instances(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_agent_instances_agent_type ON agent_instances(agent_type)');

    // Step 6: Create trigger to update updated_at timestamp
    await run(`
      CREATE TRIGGER IF NOT EXISTS update_agent_instances_updated_at
        AFTER UPDATE ON agent_instances
      BEGIN
        UPDATE agent_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    console.log('Migration 006: Successfully added multi-agent support');
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    // Step 1: Create claude_instances table (restore old structure)
    await run(`
      CREATE TABLE IF NOT EXISTS claude_instances (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'error')),
        pid INTEGER,
        port INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
        FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
      )
    `);

    // Step 2: Copy Claude instances back to claude_instances table
    await run(`
      INSERT OR IGNORE INTO claude_instances (
        id, repository_id, worktree_id, status, pid, port,
        created_at, updated_at, last_activity
      )
      SELECT
        id, repository_id, worktree_id, status, pid, port,
        created_at, updated_at, last_activity
      FROM agent_instances
      WHERE agent_type = 'claude'
    `);

    // Step 3: Drop agent_instances table
    await run('DROP TRIGGER IF EXISTS update_agent_instances_updated_at');
    await run('DROP INDEX IF EXISTS idx_agent_instances_repository_id');
    await run('DROP INDEX IF EXISTS idx_agent_instances_worktree_id');
    await run('DROP INDEX IF EXISTS idx_agent_instances_status');
    await run('DROP INDEX IF EXISTS idx_agent_instances_agent_type');
    await run('DROP TABLE IF EXISTS agent_instances');

    // Step 4: Remove preferred_agent column from worktrees (SQLite doesn't support DROP COLUMN directly)
    // We'll need to recreate the table without the column
    await run(`
      CREATE TABLE worktrees_backup AS
      SELECT id, repository_id, path, branch, created_at, updated_at
      FROM worktrees
    `);

    await run('DROP TABLE worktrees');

    await run(`
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `);

    await run(`
      INSERT INTO worktrees (id, repository_id, path, branch, created_at, updated_at)
      SELECT id, repository_id, path, branch, created_at, updated_at
      FROM worktrees_backup
    `);

    await run('DROP TABLE worktrees_backup');

    // Step 5: Recreate indexes and triggers for claude_instances
    await run('CREATE INDEX IF NOT EXISTS idx_worktrees_repository_id ON worktrees(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_repository_id ON claude_instances(repository_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_worktree_id ON claude_instances(worktree_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_instances_status ON claude_instances(status)');

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_worktrees_updated_at
        AFTER UPDATE ON worktrees
      BEGIN
        UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS update_instances_updated_at
        AFTER UPDATE ON claude_instances
      BEGIN
        UPDATE claude_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `);

    console.log('Migration 006: Successfully reverted multi-agent support');
  }
};

export default migration;