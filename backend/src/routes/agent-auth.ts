import { Router } from 'express';
import { agentAuthService, AuthProvider } from '../services/agent-auth.js';
import { TerminalService } from '../services/terminal.js';
import { AgentType } from '../types.js';

export function createAgentAuthRoutes(terminalService: TerminalService): Router {
  const router = Router();

  router.get('/providers', (_req, res) => {
    const providers: AuthProvider[] = ['anthropic', 'openai', 'google', 'github'];
    res.json({ providers });
  });

  router.get('/supported/:agentType', (req, res) => {
    const agentType = req.params.agentType as AgentType;
    const config = agentAuthService.getAuthConfig(agentType);
    
    if (!config) {
      return res.json({ 
        supported: false, 
        message: `Agent type '${agentType}' does not support interactive authentication` 
      });
    }

    res.json({
      supported: true,
      hasLoginCommand: config.loginCommand.length > 0,
      hasTuiMode: !!config.tuiCommand
    });
  });

  router.post('/start', async (req, res) => {
    try {
      const { agentType, provider, useLoginCommand, userId } = req.body as {
        agentType: AgentType;
        provider?: AuthProvider;
        useLoginCommand?: boolean;
        userId?: string;
      };

      if (!agentType) {
        return res.status(400).json({ error: 'agentType is required' });
      }

      if (!agentAuthService.supportsInteractiveAuth(agentType)) {
        return res.status(400).json({ 
          error: `Agent type '${agentType}' does not support interactive authentication` 
        });
      }

      const session = await agentAuthService.startAuthSession(agentType, {
        userId,
        provider,
        useLoginCommand
      });

      res.status(201).json({
        sessionId: session.id,
        agentType: session.agentType,
        status: session.status
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to start auth session', 
        details: String(error) 
      });
    }
  });

  router.get('/session/:sessionId', (req, res) => {
    const session = agentAuthService.getSession(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Auth session not found' });
    }

    res.json({
      id: session.id,
      agentType: session.agentType,
      provider: session.provider,
      status: session.status,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      error: session.error
    });
  });

  router.post('/session/:sessionId/terminal', (req, res) => {
    try {
      const pty = agentAuthService.getSessionPty(req.params.sessionId);
      
      if (!pty) {
        return res.status(404).json({ error: 'Auth session not found or already completed' });
      }

      const terminalSession = terminalService.createAgentPtySession(
        `auth-${req.params.sessionId}`,
        pty
      );

      res.json({ sessionId: terminalSession.id });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to create terminal session', 
        details: String(error) 
      });
    }
  });

  router.post('/session/:sessionId/cancel', (req, res) => {
    try {
      const session = agentAuthService.getSession(req.params.sessionId);
      
      if (!session) {
        return res.status(404).json({ error: 'Auth session not found' });
      }

      agentAuthService.cancelSession(req.params.sessionId);

      res.json({ status: 'cancelled' });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to cancel auth session', 
        details: String(error) 
      });
    }
  });

  router.delete('/session/:sessionId', (req, res) => {
    try {
      agentAuthService.cleanupSession(req.params.sessionId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to cleanup auth session', 
        details: String(error) 
      });
    }
  });

  router.get('/sessions', (_req, res) => {
    const sessions = agentAuthService.getActiveSessions();
    res.json(sessions.map(s => ({
      id: s.id,
      agentType: s.agentType,
      provider: s.provider,
      status: s.status,
      createdAt: s.createdAt
    })));
  });

  router.post('/verify/:agentType', async (req, res) => {
    try {
      const agentType = req.params.agentType as AgentType;
      const { userId } = req.body || {};
      
      const result = await agentAuthService.verifyAuthStatus(agentType, userId);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to verify auth status', 
        details: String(error) 
      });
    }
  });

  return router;
}
