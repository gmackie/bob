import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { authConfig } from '../config/auth.config.js';
import { DatabaseService } from '../database/database.js';

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  accessToken?: string;
  provider: 'github';
}

export class AuthService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.initializeDatabase();
    this.configurePassport();
  }

  private async initializeDatabase() {
    // Create users table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        displayName TEXT,
        email TEXT,
        avatarUrl TEXT,
        accessToken TEXT,
        provider TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastLogin DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create sessions table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expiresAt DATETIME NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `);
  }

  private configurePassport() {
    const { clientID, clientSecret, callbackURL } = authConfig.github;

    if (!clientID || !clientSecret) {
      console.warn('GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.');
      return;
    }

    passport.use(new GitHubStrategy({
      clientID,
      clientSecret,
      callbackURL
    }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
      try {
        // Check if user is in the allowed list
        if (!authConfig.isUserAllowed(profile.username)) {
          console.log(`Access denied for user: ${profile.username}`);
          return done(null, false, { message: 'Access denied. User not authorized.' });
        }

        const user: User = {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          email: profile.emails?.[0]?.value,
          avatarUrl: profile.photos?.[0]?.value,
          accessToken,
          provider: 'github'
        };

        // Upsert user in database
        await this.db.run(`
          INSERT INTO users (id, username, displayName, email, avatarUrl, accessToken, provider, lastLogin)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            displayName = excluded.displayName,
            email = excluded.email,
            avatarUrl = excluded.avatarUrl,
            accessToken = excluded.accessToken,
            lastLogin = CURRENT_TIMESTAMP
        `, [
          user.id,
          user.username,
          user.displayName || null,
          user.email || null,
          user.avatarUrl || null,
          user.accessToken || null,
          user.provider
        ]);

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }));

    passport.serializeUser((user: any, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (id: string, done) => {
      try {
        const user = await this.db.get(`
          SELECT id, username, displayName, email, avatarUrl, provider
          FROM users WHERE id = ?
        `, [id]) as User | undefined;
        done(null, user || false);
      } catch (error) {
        done(error);
      }
    });
  }

  async createSession(userId: string): Promise<string> {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.db.run(`
      INSERT INTO sessions (id, userId, token, expiresAt)
      VALUES (?, ?, ?, ?)
    `, [sessionId, userId, token, expiresAt.toISOString()]);

    return token;
  }

  async validateSession(token: string): Promise<User | null> {
    const user = await this.db.get(`
      SELECT u.id, u.username, u.displayName, u.email, u.avatarUrl, u.provider
      FROM sessions s
      JOIN users u ON s.userId = u.id
      WHERE s.token = ? AND s.expiresAt > datetime('now')
    `, [token]) as User | undefined;

    return user || null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE token = ?', [token]);
  }

  async cleanupExpiredSessions(): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE expiresAt < datetime("now")');
  }

  private generateToken(): string {
    return Array.from({ length: 32 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
  }

  async getUserById(userId: string): Promise<User | null> {
    const user = await this.db.get(`
      SELECT id, username, displayName, email, avatarUrl, provider
      FROM users WHERE id = ?
    `, [userId]) as User | undefined;
    return user || null;
  }

  isConfigured(): boolean {
    return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  }
}