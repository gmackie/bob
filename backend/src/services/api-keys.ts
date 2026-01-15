import crypto from 'crypto';
import { DatabaseService } from '../database/database.js';

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitRequests: number;
  rateLimitWindowSeconds: number;
  isActive: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyUsageLog {
  id: number;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode?: number;
  requestIp?: string;
  userAgent?: string;
  responseTimeMs?: number;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  userId: string;
  name: string;
  scopes?: string[];
  rateLimitRequests?: number;
  rateLimitWindowSeconds?: number;
  expiresAt?: string;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  rawKey: string;
}

export class ApiKeyService {
  constructor(private db: DatabaseService) {}

  private generateKeyId(): string {
    return `ak_${crypto.randomBytes(12).toString('hex')}`;
  }

  private generateRawKey(): string {
    return `bob_${crypto.randomBytes(32).toString('hex')}`;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private getKeyPrefix(rawKey: string): string {
    return rawKey.substring(0, 12);
  }

  async create(request: CreateApiKeyRequest): Promise<CreateApiKeyResult> {
    const id = this.generateKeyId();
    const rawKey = this.generateRawKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = this.getKeyPrefix(rawKey);

    const scopes = request.scopes || ['read'];
    const rateLimitRequests = request.rateLimitRequests ?? 1000;
    const rateLimitWindowSeconds = request.rateLimitWindowSeconds ?? 3600;

    await this.db.run(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, rate_limit_requests, rate_limit_window_seconds, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.userId, request.name, keyHash, keyPrefix, JSON.stringify(scopes), rateLimitRequests, rateLimitWindowSeconds, request.expiresAt || null]
    );

    const apiKey = await this.getById(id);
    if (!apiKey) {
      throw new Error('Failed to create API key');
    }

    return { apiKey, rawKey };
  }

  async getById(id: string): Promise<ApiKey | null> {
    const row = await this.db.get('SELECT * FROM api_keys WHERE id = ?', [id]);
    return row ? this.mapRowToApiKey(row) : null;
  }

  async getByUserId(userId: string): Promise<ApiKey[]> {
    const rows = await this.db.all('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows.map(this.mapRowToApiKey);
  }

  async validateKey(rawKey: string): Promise<ApiKey | null> {
    const keyHash = this.hashKey(rawKey);
    const row = await this.db.get(
      'SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1',
      [keyHash]
    );

    if (!row) return null;

    const apiKey = this.mapRowToApiKey(row);

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return null;
    }

    await this.db.run(
      'UPDATE api_keys SET last_used_at = datetime("now") WHERE id = ?',
      [apiKey.id]
    );

    return apiKey;
  }

  async checkRateLimit(apiKeyId: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const apiKey = await this.getById(apiKeyId);
    if (!apiKey) {
      return { allowed: false, remaining: 0, resetAt: new Date() };
    }

    const row = await this.db.get(
      'SELECT * FROM api_rate_limits WHERE api_key_id = ?',
      [apiKeyId]
    );

    const now = new Date();
    
    if (!row) {
      await this.db.run(
        'INSERT INTO api_rate_limits (api_key_id, request_count, window_start) VALUES (?, 1, datetime("now"))',
        [apiKeyId]
      );
      const resetAt = new Date(now.getTime() + apiKey.rateLimitWindowSeconds * 1000);
      return { allowed: true, remaining: apiKey.rateLimitRequests - 1, resetAt };
    }

    const windowStart = new Date(row.window_start);
    const windowEnd = new Date(windowStart.getTime() + apiKey.rateLimitWindowSeconds * 1000);

    if (now > windowEnd) {
      await this.db.run(
        'UPDATE api_rate_limits SET request_count = 1, window_start = datetime("now") WHERE api_key_id = ?',
        [apiKeyId]
      );
      const resetAt = new Date(now.getTime() + apiKey.rateLimitWindowSeconds * 1000);
      return { allowed: true, remaining: apiKey.rateLimitRequests - 1, resetAt };
    }

    if (row.request_count >= apiKey.rateLimitRequests) {
      return { allowed: false, remaining: 0, resetAt: windowEnd };
    }

    await this.db.run(
      'UPDATE api_rate_limits SET request_count = request_count + 1 WHERE api_key_id = ?',
      [apiKeyId]
    );

    return { 
      allowed: true, 
      remaining: apiKey.rateLimitRequests - row.request_count - 1, 
      resetAt: windowEnd 
    };
  }

  async logUsage(
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode?: number,
    requestIp?: string,
    userAgent?: string,
    responseTimeMs?: number
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO api_key_usage (api_key_id, endpoint, method, status_code, request_ip, user_agent, response_time_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [apiKeyId, endpoint, method, statusCode, requestIp, userAgent, responseTimeMs]
    );
  }

  async getUsageStats(apiKeyId: string, days: number = 7): Promise<{
    totalRequests: number;
    requestsByDay: Array<{ date: string; count: number }>;
    requestsByEndpoint: Array<{ endpoint: string; count: number }>;
    avgResponseTimeMs: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const total = await this.db.get(
      'SELECT COUNT(*) as count FROM api_key_usage WHERE api_key_id = ? AND created_at >= ?',
      [apiKeyId, cutoffStr]
    );

    const byDay = await this.db.all(
      `SELECT date(created_at) as date, COUNT(*) as count 
       FROM api_key_usage 
       WHERE api_key_id = ? AND created_at >= ?
       GROUP BY date(created_at)
       ORDER BY date DESC`,
      [apiKeyId, cutoffStr]
    );

    const byEndpoint = await this.db.all(
      `SELECT endpoint, COUNT(*) as count 
       FROM api_key_usage 
       WHERE api_key_id = ? AND created_at >= ?
       GROUP BY endpoint
       ORDER BY count DESC
       LIMIT 10`,
      [apiKeyId, cutoffStr]
    );

    const avgResponse = await this.db.get(
      'SELECT AVG(response_time_ms) as avg FROM api_key_usage WHERE api_key_id = ? AND created_at >= ? AND response_time_ms IS NOT NULL',
      [apiKeyId, cutoffStr]
    );

    return {
      totalRequests: total?.count || 0,
      requestsByDay: byDay.map((r: any) => ({ date: r.date, count: r.count })),
      requestsByEndpoint: byEndpoint.map((r: any) => ({ endpoint: r.endpoint, count: r.count })),
      avgResponseTimeMs: avgResponse?.avg || 0
    };
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.db.run(
      'UPDATE api_keys SET is_active = 0, updated_at = datetime("now") WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return result.changes > 0;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return result.changes > 0;
  }

  private mapRowToApiKey(row: any): ApiKey {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      scopes: JSON.parse(row.scopes || '["read"]'),
      rateLimitRequests: row.rate_limit_requests,
      rateLimitWindowSeconds: row.rate_limit_window_seconds,
      isActive: row.is_active === 1,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
