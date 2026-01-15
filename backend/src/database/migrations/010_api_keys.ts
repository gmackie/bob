import { Migration } from './migration-interface.js';
import { promisify } from 'util';

const migration: Migration = {
  id: 10,
  name: '010_api_keys',
  description: 'Add api_keys table for API authentication with hashed keys, rate limits, and audit logging',

  async up(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));

    await run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        scopes TEXT DEFAULT '["read"]',
        rate_limit_requests INTEGER DEFAULT 1000,
        rate_limit_window_seconds INTEGER DEFAULT 3600,
        is_active INTEGER DEFAULT 1,
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, name)
      )
    `);

    await run(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix)`);

    await run(`
      CREATE TABLE IF NOT EXISTS api_key_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER,
        request_ip TEXT,
        user_agent TEXT,
        response_time_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      )
    `);

    await run(`CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_id ON api_key_usage(api_key_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_api_key_usage_created_at ON api_key_usage(created_at)`);

    await run(`
      CREATE TABLE IF NOT EXISTS api_rate_limits (
        api_key_id TEXT PRIMARY KEY,
        request_count INTEGER DEFAULT 0,
        window_start TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      )
    `);
  },

  async down(db: any): Promise<void> {
    const run = promisify(db.run.bind(db));
    
    await run('DROP TABLE IF EXISTS api_rate_limits');
    await run('DROP TABLE IF EXISTS api_key_usage');
    await run('DROP TABLE IF EXISTS api_keys');
  }
};

export default migration;
