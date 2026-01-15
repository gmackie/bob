import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 9,
  name: '009_multi_user_support',
  description: 'Add user_id columns to all resource tables for multi-tenant support',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    const all = promisify(db.all.bind(db));

    await run('PRAGMA foreign_keys = OFF');

    try {
      await run(`
        CREATE TABLE repositories_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          branch TEXT NOT NULL,
          main_branch TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, path)
        )
      `);

      await run(`
        INSERT INTO repositories_new (id, user_id, name, path, branch, main_branch, created_at, updated_at)
        SELECT id, 'default-user', name, path, branch, main_branch, created_at, updated_at
        FROM repositories
      `);

      await run('DROP TABLE repositories');
      await run('ALTER TABLE repositories_new RENAME TO repositories');

      await run('CREATE INDEX idx_repositories_user_id ON repositories(user_id)');
      await run('CREATE INDEX idx_repositories_path ON repositories(path)');
      await run('CREATE INDEX idx_repositories_user_path ON repositories(user_id, path)');

      await run(`
        CREATE TABLE worktrees_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          repository_id TEXT NOT NULL,
          path TEXT NOT NULL,
          branch TEXT NOT NULL,
          preferred_agent TEXT DEFAULT 'claude',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
          UNIQUE(user_id, path)
        )
      `);

      await run(`
        INSERT INTO worktrees_new (id, user_id, repository_id, path, branch, preferred_agent, created_at, updated_at)
        SELECT id, 'default-user', repository_id, path, branch, preferred_agent, created_at, updated_at
        FROM worktrees
      `);

      await run('DROP TABLE worktrees');
      await run('ALTER TABLE worktrees_new RENAME TO worktrees');

      await run('CREATE INDEX idx_worktrees_user_id ON worktrees(user_id)');
      await run('CREATE INDEX idx_worktrees_repository_id ON worktrees(repository_id)');
      await run('CREATE INDEX idx_worktrees_path ON worktrees(path)');
      await run('CREATE INDEX idx_worktrees_user_path ON worktrees(user_id, path)');

      await run(`
        CREATE TABLE agent_instances_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          repository_id TEXT NOT NULL,
          worktree_id TEXT NOT NULL,
          agent_type TEXT NOT NULL DEFAULT 'claude',
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
        INSERT INTO agent_instances_new (id, user_id, repository_id, worktree_id, agent_type, status, pid, port, error_message, created_at, updated_at, last_activity)
        SELECT id, 'default-user', repository_id, worktree_id, agent_type, status, pid, port, error_message, created_at, updated_at, last_activity
        FROM agent_instances
      `);

      await run('DROP TABLE agent_instances');
      await run('ALTER TABLE agent_instances_new RENAME TO agent_instances');

      await run('CREATE INDEX idx_agent_instances_user_id ON agent_instances(user_id)');
      await run('CREATE INDEX idx_agent_instances_repository_id ON agent_instances(repository_id)');
      await run('CREATE INDEX idx_agent_instances_worktree_id ON agent_instances(worktree_id)');
      await run('CREATE INDEX idx_agent_instances_status ON agent_instances(status)');
      await run('CREATE INDEX idx_agent_instances_agent_type ON agent_instances(agent_type)');

      await run(`
        CREATE TABLE git_analysis_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          worktree_id TEXT NOT NULL,
          git_hash TEXT NOT NULL,
          analysis_summary TEXT,
          analysis_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
          UNIQUE(user_id, worktree_id, git_hash)
        )
      `);

      await run(`
        INSERT INTO git_analysis_new (id, user_id, worktree_id, git_hash, analysis_summary, analysis_timestamp, created_at, updated_at)
        SELECT id, 'default-user', worktree_id, git_hash, analysis_summary, analysis_timestamp, created_at, updated_at
        FROM git_analysis
      `);

      await run('DROP TABLE git_analysis');
      await run('ALTER TABLE git_analysis_new RENAME TO git_analysis');

      await run('CREATE INDEX idx_git_analysis_user_id ON git_analysis(user_id)');
      await run('CREATE INDEX idx_git_analysis_worktree ON git_analysis(worktree_id)');
      await run('CREATE INDEX idx_git_analysis_hash ON git_analysis(git_hash)');

      await run(`
        CREATE TABLE diff_comments_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          analysis_id TEXT NOT NULL,
          worktree_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          line_number INTEGER NOT NULL,
          comment_type TEXT NOT NULL CHECK (comment_type IN ('suggestion', 'warning', 'error', 'user')),
          message TEXT NOT NULL,
          severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
          is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
          user_reply TEXT,
          is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (analysis_id) REFERENCES git_analysis(id) ON DELETE CASCADE,
          FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
        )
      `);

      await run(`
        INSERT INTO diff_comments_new (id, user_id, analysis_id, worktree_id, file_path, line_number, comment_type, message, severity, is_ai_generated, user_reply, is_dismissed, created_at, updated_at)
        SELECT id, 'default-user', analysis_id, worktree_id, file_path, line_number, comment_type, message, severity, is_ai_generated, user_reply, is_dismissed, created_at, updated_at
        FROM diff_comments
      `);

      await run('DROP TABLE diff_comments');
      await run('ALTER TABLE diff_comments_new RENAME TO diff_comments');

      await run('CREATE INDEX idx_diff_comments_user_id ON diff_comments(user_id)');
      await run('CREATE INDEX idx_diff_comments_analysis ON diff_comments(analysis_id)');
      await run('CREATE INDEX idx_diff_comments_worktree ON diff_comments(worktree_id)');
      await run('CREATE INDEX idx_diff_comments_file ON diff_comments(file_path)');

      await run(`
        CREATE TABLE token_usage_sessions_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          instance_id TEXT NOT NULL,
          worktree_id TEXT NOT NULL,
          repository_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          total_cost_usd DECIMAL(10,4) DEFAULT 0,
          session_start DATETIME NOT NULL,
          session_end DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (instance_id) REFERENCES agent_instances(id) ON DELETE CASCADE,
          FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
          FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
        )
      `);

      await run(`
        INSERT INTO token_usage_sessions_new (id, user_id, instance_id, worktree_id, repository_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, session_start, session_end, created_at, updated_at)
        SELECT id, 'default-user', instance_id, worktree_id, repository_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, session_start, session_end, created_at, updated_at
        FROM token_usage_sessions
      `);

      await run('DROP TABLE token_usage_sessions');
      await run('ALTER TABLE token_usage_sessions_new RENAME TO token_usage_sessions');

      await run('CREATE INDEX idx_token_sessions_user_id ON token_usage_sessions(user_id)');
      await run('CREATE INDEX idx_token_sessions_instance_id ON token_usage_sessions(instance_id)');

      await run(`
        CREATE TABLE instance_usage_summary_new (
          instance_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          worktree_id TEXT NOT NULL,
          repository_id TEXT NOT NULL,
          total_input_tokens INTEGER NOT NULL DEFAULT 0,
          total_output_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          total_cost_usd DECIMAL(10,4) DEFAULT 0,
          session_count INTEGER NOT NULL DEFAULT 0,
          first_usage DATETIME,
          last_usage DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (instance_id) REFERENCES agent_instances(id) ON DELETE CASCADE,
          FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE,
          FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
        )
      `);

      await run(`
        INSERT INTO instance_usage_summary_new (instance_id, user_id, worktree_id, repository_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, session_count, first_usage, last_usage, created_at, updated_at)
        SELECT instance_id, 'default-user', worktree_id, repository_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, session_count, first_usage, last_usage, created_at, updated_at
        FROM instance_usage_summary
      `);

      await run('DROP TABLE instance_usage_summary');
      await run('ALTER TABLE instance_usage_summary_new RENAME TO instance_usage_summary');

      await run('CREATE INDEX idx_instance_summary_user_id ON instance_usage_summary(user_id)');
      await run('CREATE INDEX idx_instance_summary_worktree ON instance_usage_summary(worktree_id)');

      await run(`
        CREATE TABLE daily_usage_stats_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL DEFAULT 'default-user',
          date TEXT NOT NULL,
          total_input_tokens INTEGER NOT NULL DEFAULT 0,
          total_output_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          total_cost_usd DECIMAL(10,4) DEFAULT 0,
          session_count INTEGER NOT NULL DEFAULT 0,
          active_instances INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, date)
        )
      `);

      await run(`
        INSERT INTO daily_usage_stats_new (user_id, date, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, session_count, active_instances, created_at, updated_at)
        SELECT 'default-user', date, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, session_count, active_instances, created_at, updated_at
        FROM daily_usage_stats
      `);

      await run('DROP TABLE daily_usage_stats');
      await run('ALTER TABLE daily_usage_stats_new RENAME TO daily_usage_stats');

      await run('CREATE INDEX idx_daily_stats_user_id ON daily_usage_stats(user_id)');
      await run('CREATE INDEX idx_daily_stats_date ON daily_usage_stats(date)');
      await run('CREATE INDEX idx_daily_stats_user_date ON daily_usage_stats(user_id, date)');

      await run(`
        CREATE TRIGGER update_repositories_updated_at 
          AFTER UPDATE ON repositories
        BEGIN
          UPDATE repositories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
      `);

      await run(`
        CREATE TRIGGER update_worktrees_updated_at 
          AFTER UPDATE ON worktrees
        BEGIN
          UPDATE worktrees SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
      `);

      await run(`
        CREATE TRIGGER update_agent_instances_updated_at
          AFTER UPDATE ON agent_instances
        BEGIN
          UPDATE agent_instances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
      `);

      await run(`
        CREATE TRIGGER update_git_analysis_updated_at
          AFTER UPDATE ON git_analysis
        BEGIN
          UPDATE git_analysis SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
      `);

      await run(`
        CREATE TRIGGER update_diff_comments_updated_at
          AFTER UPDATE ON diff_comments
        BEGIN
          UPDATE diff_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
      `);

      await run('PRAGMA foreign_keys = ON');

      console.log('Migration 009: Successfully added multi-user support');
    } catch (error) {
      await run('PRAGMA foreign_keys = ON');
      throw error;
    }
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    console.log('Migration 009 down: Removing user_id columns is a destructive operation.');
    console.log('This rollback will preserve only default-user data.');

    await run('PRAGMA foreign_keys = OFF');

    try {
      await run('DROP TRIGGER IF EXISTS update_repositories_updated_at');
      await run('DROP TRIGGER IF EXISTS update_worktrees_updated_at');
      await run('DROP TRIGGER IF EXISTS update_agent_instances_updated_at');
      await run('DROP TRIGGER IF EXISTS update_git_analysis_updated_at');
      await run('DROP TRIGGER IF EXISTS update_diff_comments_updated_at');

      await run(`
        CREATE TABLE repositories_old (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          branch TEXT NOT NULL,
          main_branch TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await run(`
        INSERT INTO repositories_old (id, name, path, branch, main_branch, created_at, updated_at)
        SELECT id, name, path, branch, main_branch, created_at, updated_at
        FROM repositories WHERE user_id = 'default-user'
      `);

      await run('DROP TABLE repositories');
      await run('ALTER TABLE repositories_old RENAME TO repositories');

      await run('PRAGMA foreign_keys = ON');

      console.log('Migration 009: Rollback complete (partial - repositories only for safety)');
    } catch (error) {
      await run('PRAGMA foreign_keys = ON');
      throw error;
    }
  }
};

export default migration;
