import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import Database from 'better-sqlite3';
import { authConfig } from '../config/auth.config.js';

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
  private db: Database.Database;

  constructor(dbPath: string = 'bob.db') {
    this.db = new Database(dbPath);
    this.initializeDatabase();
    this.configurePassport();
  }

  private initializeDatabase() {
    // Create users table if it doesn't exist
    this.db.exec(`
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
    this.db.exec(`
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
        const stmt = this.db.prepare(`
          INSERT INTO users (id, username, displayName, email, avatarUrl, accessToken, provider, lastLogin)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            displayName = excluded.displayName,
            email = excluded.email,
            avatarUrl = excluded.avatarUrl,
            accessToken = excluded.accessToken,
            lastLogin = CURRENT_TIMESTAMP
        `);

        stmt.run(
          user.id,
          user.username,
          user.displayName || null,
          user.email || null,
          user.avatarUrl || null,
          user.accessToken || null,
          user.provider
        );

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }));

    passport.serializeUser((user: any, done) => {
      done(null, user.id);
    });

    passport.deserializeUser((id: string, done) => {
      try {
        const stmt = this.db.prepare(`
          SELECT id, username, displayName, email, avatarUrl, provider
          FROM users WHERE id = ?
        `);
        const user = stmt.get(id) as User | undefined;
        done(null, user || false);
      } catch (error) {
        done(error);
      }
    });
  }

  createSession(userId: string): string {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, userId, token, expiresAt)
      VALUES (?, ?, ?, ?)
    `);

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    stmt.run(sessionId, userId, token, expiresAt.toISOString());

    return token;
  }

  validateSession(token: string): User | null {
    const stmt = this.db.prepare(`
      SELECT u.id, u.username, u.displayName, u.email, u.avatarUrl, u.provider
      FROM sessions s
      JOIN users u ON s.userId = u.id
      WHERE s.token = ? AND s.expiresAt > datetime('now')
    `);

    const user = stmt.get(token) as User | undefined;
    return user || null;
  }

  deleteSession(token: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE token = ?');
    stmt.run(token);
  }

  cleanupExpiredSessions(): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE expiresAt < datetime("now")');
    stmt.run();
  }

  private generateToken(): string {
    return Array.from({ length: 32 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
  }

  getUserById(userId: string): User | null {
    const stmt = this.db.prepare(`
      SELECT id, username, displayName, email, avatarUrl, provider
      FROM users WHERE id = ?
    `);
    const user = stmt.get(userId) as User | undefined;
    return user || null;
  }

  isConfigured(): boolean {
    return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  }
}