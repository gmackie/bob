import { Migration } from './migration-interface.js';

export const migration: Migration = {
  id: 8,
  name: '008_oauth_tokens',
  description: 'Add encrypted OAuth token storage for AI provider authentication',
  
  up: async (db: any) => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        provider TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        token_type TEXT,
        scope TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      )
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider
      ON oauth_tokens(user_id, provider)
    `);
  },
  
  down: async (db: any) => {
    await db.run('DROP TABLE IF EXISTS oauth_tokens');
  }
};
