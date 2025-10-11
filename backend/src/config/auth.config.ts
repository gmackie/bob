// Authentication configuration
export const authConfig = {
  // List of GitHub usernames allowed to access the application
  // Can be configured via GITHUB_USER_ALLOWLIST environment variable (comma-separated)
  allowedUsers: process.env.GITHUB_USER_ALLOWLIST
    ? process.env.GITHUB_USER_ALLOWLIST.split(',').map(u => u.trim().toLowerCase())
    : [], // Empty array means all authenticated users are allowed

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },

  // GitHub OAuth configuration
  github: {
    clientID: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/github/callback',
  },

  // Check if a username is allowed
  isUserAllowed: (username: string): boolean => {
    // If no allowlist is configured, allow all authenticated users
    if (authConfig.allowedUsers.length === 0) {
      return true;
    }
    return authConfig.allowedUsers.includes(username.toLowerCase());
  }
};