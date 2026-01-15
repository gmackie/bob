import { Router } from 'express';
import { tunnelService, TunnelInfo } from '../services/tunnel.js';

export function createTunnelRoutes(): Router {
  const router = Router();

  /**
   * GET /api/system/tunnel/status
   * Get current tunnel status and availability
   */
  router.get('/status', async (_req, res) => {
    try {
      const status = tunnelService.getStatus();
      const isAvailable = await tunnelService.isNgrokAvailable();

      res.json({
        ...status,
        ngrokAvailable: isAvailable,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get tunnel status',
        details: String(error),
      });
    }
  });

  /**
   * POST /api/system/tunnel/start
   * Start ngrok tunnel to expose local server
   * Body: { authtoken?: string, domain?: string }
   */
  router.post('/start', async (req, res) => {
    try {
      const { authtoken, domain } = req.body || {};

      const isAvailable = await tunnelService.isNgrokAvailable();
      if (!isAvailable) {
        return res.status(503).json({
          error: 'ngrok SDK not available',
          message: 'Install @ngrok/ngrok package to enable tunnel functionality: npm install @ngrok/ngrok',
          installCommand: 'npm install @ngrok/ngrok',
        });
      }

      const status = await tunnelService.start({ authtoken, domain });

      if (status.status === 'error') {
        return res.status(500).json({
          error: 'Failed to start tunnel',
          details: status.error,
        });
      }

      res.status(201).json(status);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start tunnel',
        details: String(error),
      });
    }
  });

  /**
   * POST /api/system/tunnel/stop
   * Stop the running ngrok tunnel
   */
  router.post('/stop', async (_req, res) => {
    try {
      const status = await tunnelService.stop();
      res.json(status);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to stop tunnel',
        details: String(error),
      });
    }
  });

  /**
   * GET /api/system/tunnel/callback-url
   * Get the public callback URL for a given path
   * Query: ?path=/api/oauth/callback/openai
   */
  router.get('/callback-url', (req, res) => {
    const path = req.query.path as string;

    if (!path) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const callbackUrl = tunnelService.getCallbackUrl(path);

    if (!callbackUrl) {
      return res.status(404).json({
        error: 'Tunnel not running',
        message: 'Start the tunnel first using POST /api/system/tunnel/start',
      });
    }

    res.json({ callbackUrl });
  });

  return router;
}
