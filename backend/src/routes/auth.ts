import { Router, Request, Response } from 'express';
import passport from 'passport';
import { AuthService } from '../services/auth.js';

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  // Check auth status
  router.get('/status', async (req: Request, res: Response) => {
    const authToken = req.headers.authorization?.replace('Bearer ', '') ||
                     req.cookies?.authToken;

    if (!authToken) {
      return res.json({
        authenticated: false,
        configured: authService.isConfigured()
      });
    }

    const user = await authService.validateSession(authToken);
    if (!user) {
      return res.json({
        authenticated: false,
        configured: authService.isConfigured()
      });
    }

    res.json({
      authenticated: true,
      configured: authService.isConfigured(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl
      }
    });
  });

  // Initiate GitHub OAuth
  router.get('/github', (req: Request, res: Response, next) => {
    if (!authService.isConfigured()) {
      return res.status(501).json({
        error: 'GitHub OAuth not configured',
        message: 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables'
      });
    }
    passport.authenticate('github', { scope: ['user:email', 'repo'] })(req, res, next);
  });

  // GitHub OAuth callback
  router.get('/github/callback',
    (req: Request, res: Response, next) => {
      if (!authService.isConfigured()) {
        return res.status(501).json({
          error: 'GitHub OAuth not configured'
        });
      }
      next();
    },
    passport.authenticate('github', { session: false }),
    async (req: Request, res: Response) => {
      const user = req.user as any;

      // Determine the frontend URL based on environment
      const getFrontendUrl = () => {
        // In development, use localhost
        if (process.env.NODE_ENV !== 'production') {
          return 'http://localhost:5173';
        }
        // In production, use environment variable or fallback
        return process.env.FRONTEND_URL || 'https://claude.gmac.io';
      };

      const frontendUrl = getFrontendUrl();

      if (!user) {
        return res.redirect(`${frontendUrl}/?auth=failed`);
      }

      // Create session token
      const token = await authService.createSession(user.id);

      // Redirect with token as query parameter
      // Frontend will handle storing it
      res.redirect(`${frontendUrl}/?auth=success&token=${token}`);
    }
  );

  // Logout
  router.post('/logout', async (req: Request, res: Response) => {
    const authToken = req.headers.authorization?.replace('Bearer ', '') ||
                     req.cookies?.authToken;

    if (authToken) {
      await authService.deleteSession(authToken);
    }

    res.json({ success: true });
  });

  // Middleware to validate authentication
  router.get('/validate', async (req: Request, res: Response) => {
    const authToken = req.headers.authorization?.replace('Bearer ', '') ||
                     req.cookies?.authToken;

    if (!authToken) {
      return res.status(401).json({ error: 'No auth token provided' });
    }

    const user = await authService.validateSession(authToken);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({ valid: true, user });
  });

  return router;
}

// Middleware function to protect routes
export function requireAuth(authService: AuthService) {
  return async (req: Request & { user?: any }, res: Response, next: Function) => {
    const authToken = req.headers.authorization?.replace('Bearer ', '') ||
                     (req as any).cookies?.authToken;

    if (!authToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await authService.validateSession(authToken);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  };
}