import crypto from 'crypto';
import { DatabaseService } from '../database/database.js';

export type OAuthProvider = 'anthropic' | 'openai' | 'google' | 'github';

export interface StoredToken {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface EncryptedTokenRow {
  id: string;
  user_id: string;
  provider: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string | null;
  scope: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

export class TokenStorageService {
  private db: DatabaseService;
  private encryptionKey: Buffer | null = null;

  constructor(db: DatabaseService) {
    this.db = db;
    this.initializeEncryption();
  }

  private initializeEncryption(): void {
    const envKey = process.env.BOB_TOKEN_ENCRYPTION_KEY;
    
    if (envKey) {
      this.encryptionKey = crypto.scryptSync(envKey, 'bob-salt', 32);
    } else {
      console.warn('BOB_TOKEN_ENCRYPTION_KEY not set. Token storage will use a derived key from machine identity.');
      const machineId = this.getMachineId();
      this.encryptionKey = crypto.scryptSync(machineId, 'bob-machine-salt', 32);
    }
  }

  private getMachineId(): string {
    const os = require('os');
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const platform = os.platform();
    return `${platform}-${hostname}-${username}-bob`;
  }

  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption not initialized');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption not initialized');
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async storeToken(
    userId: string,
    provider: OAuthProvider,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      scope?: string;
      expiresIn?: number;
    }
  ): Promise<void> {
    const id = `${userId}-${provider}`;
    const accessTokenEncrypted = this.encrypt(tokens.accessToken);
    const refreshTokenEncrypted = tokens.refreshToken 
      ? this.encrypt(tokens.refreshToken) 
      : null;
    
    const expiresAt = tokens.expiresIn 
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null;

    await this.db.run(
      `INSERT OR REPLACE INTO oauth_tokens 
       (id, user_id, provider, access_token_encrypted, refresh_token_encrypted, 
        token_type, scope, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        id,
        userId,
        provider,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokens.tokenType || null,
        tokens.scope || null,
        expiresAt
      ]
    );
  }

  async getToken(userId: string, provider: OAuthProvider): Promise<StoredToken | null> {
    const row = await this.db.get(
      'SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?',
      [userId, provider]
    ) as EncryptedTokenRow | undefined;

    if (!row) {
      return null;
    }

    try {
      const token: StoredToken = {
        provider: row.provider as OAuthProvider,
        accessToken: this.decrypt(row.access_token_encrypted),
        refreshToken: row.refresh_token_encrypted 
          ? this.decrypt(row.refresh_token_encrypted) 
          : undefined,
        tokenType: row.token_type || undefined,
        scope: row.scope || undefined,
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };

      return token;
    } catch (error) {
      console.error(`Failed to decrypt token for ${provider}:`, error);
      return null;
    }
  }

  async deleteToken(userId: string, provider: OAuthProvider): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?',
      [userId, provider]
    );
    return (result.changes || 0) > 0;
  }

  async listTokens(userId: string): Promise<Array<{
    provider: OAuthProvider;
    hasRefreshToken: boolean;
    expiresAt?: Date;
    createdAt: Date;
  }>> {
    const rows = await this.db.all(
      `SELECT provider, refresh_token_encrypted IS NOT NULL as has_refresh, 
              expires_at, created_at 
       FROM oauth_tokens WHERE user_id = ?`,
      [userId]
    ) as Array<{
      provider: string;
      has_refresh: number;
      expires_at: string | null;
      created_at: string;
    }>;

    return rows.map(row => ({
      provider: row.provider as OAuthProvider,
      hasRefreshToken: row.has_refresh === 1,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      createdAt: new Date(row.created_at)
    }));
  }

  async isTokenExpired(userId: string, provider: OAuthProvider): Promise<boolean> {
    const row = await this.db.get(
      'SELECT expires_at FROM oauth_tokens WHERE user_id = ? AND provider = ?',
      [userId, provider]
    ) as { expires_at: string | null } | undefined;

    if (!row || !row.expires_at) {
      return false;
    }

    const expiresAt = new Date(row.expires_at);
    const bufferMs = 5 * 60 * 1000;
    return expiresAt.getTime() - bufferMs < Date.now();
  }

  async refreshTokenIfNeeded(
    userId: string,
    provider: OAuthProvider,
    refreshFn: (refreshToken: string) => Promise<{
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }>
  ): Promise<StoredToken | null> {
    const isExpired = await this.isTokenExpired(userId, provider);
    
    if (!isExpired) {
      return this.getToken(userId, provider);
    }

    const currentToken = await this.getToken(userId, provider);
    if (!currentToken?.refreshToken) {
      return null;
    }

    try {
      const newTokens = await refreshFn(currentToken.refreshToken);
      
      await this.storeToken(userId, provider, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || currentToken.refreshToken,
        tokenType: currentToken.tokenType,
        scope: currentToken.scope,
        expiresIn: newTokens.expiresIn
      });

      return this.getToken(userId, provider);
    } catch (error) {
      console.error(`Failed to refresh token for ${provider}:`, error);
      return null;
    }
  }
}
