// Authentication configuration
export const authConfig = {
  // List of GitHub usernames allowed to access the application
  allowedUsers: [
    'gmackie'  // Only gmackie is allowed access
  ],

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },

  // GitHub OAuth configuration
  github: {
    clientID: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    callbackURL: process.env.GITHUB_CALLBACK_URL || 'https://api.claude.gmac.io/api/auth/github/callback',
  },

  // Check if a username is allowed
  isUserAllowed: (username: string): boolean => {
    return authConfig.allowedUsers.includes(username.toLowerCase());
  }
};