import { Router, Request, Response } from 'express';
import { tunnelService } from '../services/tunnel.js';
import { agentAuthService, AuthProvider } from '../services/agent-auth.js';

export type OAuthProvider = 'anthropic' | 'openai' | 'google' | 'github';

interface OAuthConfig {
  tokenUrl: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  localCallbackPort?: number;
}

const OAUTH_CONFIGS: Record<OAuthProvider, OAuthConfig> = {
  openai: {
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientIdEnvVar: 'OPENAI_CLIENT_ID',
    clientSecretEnvVar: 'OPENAI_CLIENT_SECRET',
    localCallbackPort: 1455,
  },
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnvVar: 'GOOGLE_CLIENT_ID',
    clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
    localCallbackPort: 36742,
  },
  anthropic: {
    tokenUrl: 'https://console.anthropic.com/api/oauth/token',
    clientIdEnvVar: 'ANTHROPIC_CLIENT_ID',
    clientSecretEnvVar: 'ANTHROPIC_CLIENT_SECRET',
  },
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnvVar: 'GITHUB_CLIENT_ID',
    clientSecretEnvVar: 'GITHUB_CLIENT_SECRET',
  },
};

interface PendingCallback {
  provider: OAuthProvider;
  state: string;
  codeVerifier?: string;
  userId?: string;
  authSessionId?: string;
  createdAt: Date;
  expiresAt: Date;
}

const pendingCallbacks = new Map<string, PendingCallback>();
const completedCallbacks = new Map<string, { code: string; provider: OAuthProvider; completedAt: Date }>();

function cleanupExpiredCallbacks(): void {
  const now = new Date();
  for (const [state, callback] of pendingCallbacks) {
    if (callback.expiresAt < now) {
      pendingCallbacks.delete(state);
    }
  }
  for (const [state, callback] of completedCallbacks) {
    const expiresAt = new Date(callback.completedAt.getTime() + 5 * 60 * 1000);
    if (expiresAt < now) {
      completedCallbacks.delete(state);
    }
  }
}

setInterval(cleanupExpiredCallbacks, 60 * 1000);

export function createOAuthCallbackRoutes(): Router {
  const router = Router();

  router.post('/register', (req: Request, res: Response) => {
    const { provider, state, codeVerifier, userId, authSessionId } = req.body as {
      provider: OAuthProvider;
      state: string;
      codeVerifier?: string;
      userId?: string;
      authSessionId?: string;
    };

    if (!provider || !state) {
      return res.status(400).json({ error: 'provider and state are required' });
    }

    if (!OAUTH_CONFIGS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    const callback: PendingCallback = {
      provider,
      state,
      codeVerifier,
      userId,
      authSessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };

    pendingCallbacks.set(state, callback);

    const tunnelUrl = tunnelService.getPublicUrl();
    const callbackPath = `/api/oauth/callback/${provider}`;

    res.json({
      registered: true,
      state,
      callbackUrl: tunnelUrl 
        ? `${tunnelUrl}${callbackPath}`
        : `http://localhost:${OAUTH_CONFIGS[provider].localCallbackPort || 3001}${callbackPath}`,
      tunnelActive: !!tunnelUrl,
    });
  });

  router.get('/callback/:provider', (req: Request, res: Response) => {
    const provider = req.params.provider as OAuthProvider;
    const { code, state, error, error_description } = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (error) {
      return res.status(400).send(`
        <html>
          <head><title>Authentication Failed</title></head>
          <body>
            <h1>Authentication Failed</h1>
            <p>Error: ${error}</p>
            <p>${error_description || ''}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <head><title>Missing Parameters</title></head>
          <body>
            <h1>Missing Parameters</h1>
            <p>OAuth callback missing required code or state parameter.</p>
          </body>
        </html>
      `);
    }

    const pending = pendingCallbacks.get(state);
    if (!pending) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <h1>Invalid or Expired State</h1>
            <p>The OAuth state parameter is invalid or has expired. Please try again.</p>
          </body>
        </html>
      `);
    }

    if (pending.provider !== provider) {
      return res.status(400).send(`
        <html>
          <head><title>Provider Mismatch</title></head>
          <body>
            <h1>Provider Mismatch</h1>
            <p>Expected ${pending.provider}, got ${provider}.</p>
          </body>
        </html>
      `);
    }

    completedCallbacks.set(state, {
      code,
      provider,
      completedAt: new Date(),
    });
    pendingCallbacks.delete(state);

    res.send(`
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              text-align: center;
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #22c55e; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Successful!</h1>
            <p>You have successfully authenticated with ${provider}.</p>
            <p>You can close this window and return to Bob.</p>
          </div>
        </body>
      </html>
    `);
  });

  router.get('/status/:state', (req: Request, res: Response) => {
    const { state } = req.params;

    const pending = pendingCallbacks.get(state);
    if (pending) {
      return res.json({
        status: 'pending',
        provider: pending.provider,
        createdAt: pending.createdAt,
        expiresAt: pending.expiresAt,
      });
    }

    const completed = completedCallbacks.get(state);
    if (completed) {
      return res.json({
        status: 'completed',
        provider: completed.provider,
        completedAt: completed.completedAt,
        hasCode: true,
      });
    }

    res.status(404).json({ error: 'Callback not found' });
  });

  router.post('/exchange/:state', async (req: Request, res: Response) => {
    const { state } = req.params;

    const completed = completedCallbacks.get(state);
    if (!completed) {
      return res.status(404).json({ error: 'No completed callback found for this state' });
    }

    const pending = pendingCallbacks.get(state);
    const config = OAUTH_CONFIGS[completed.provider];

    const clientId = process.env[config.clientIdEnvVar];
    const clientSecret = process.env[config.clientSecretEnvVar];

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'OAuth not configured',
        message: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar} environment variables`,
      });
    }

    try {
      const tunnelUrl = tunnelService.getPublicUrl();
      const redirectUri = tunnelUrl
        ? `${tunnelUrl}/api/oauth/callback/${completed.provider}`
        : `http://localhost:${config.localCallbackPort || 3001}/api/oauth/callback/${completed.provider}`;

      const body: Record<string, string> = {
        grant_type: 'authorization_code',
        code: completed.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      };

      if (pending?.codeVerifier) {
        body.code_verifier = pending.codeVerifier;
      }

      const tokenResponse = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(body).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        return res.status(tokenResponse.status).json({
          error: 'Token exchange failed',
          details: errorText,
        });
      }

      const tokens = await tokenResponse.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
      };

      completedCallbacks.delete(state);

      res.json({
        success: true,
        provider: completed.provider,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
          scope: tokens.scope,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: 'Token exchange failed',
        details: String(error),
      });
    }
  });

  router.get('/providers', (_req: Request, res: Response) => {
    const providers = Object.entries(OAUTH_CONFIGS).map(([name, config]) => ({
      name,
      configured: !!(process.env[config.clientIdEnvVar] && process.env[config.clientSecretEnvVar]),
      localCallbackPort: config.localCallbackPort,
    }));

    res.json({ providers });
  });

  return router;
}
