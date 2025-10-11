import { Router } from 'express';
import { agentFactory } from '../agents/agent-factory.js';
import { IPty } from 'node-pty';

export function createAgentsRoutes(): Router {
  const router = Router();

  // List all known agents with availability/authentication status
  router.get('/', async (_req, res) => {
    try {
      const agents = await agentFactory.getAgentInfo();
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get agents', details: String(error) });
    }
  });

  // Get single agent by type
  router.get('/:type', async (req, res) => {
    try {
      const type = req.params.type as any;
      const info = await agentFactory.getAgentInfoById(type);
      if (!info) {
        return res.status(404).json({ error: `Agent '${type}' not found` });
      }
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get agent info', details: String(error) });
    }
  });

  // Verify one or all agents by attempting to start and stop a short-lived PTY
  router.post('/verify', async (req, res) => {
    const { type, worktreeId, timeoutMs } = req.body || {};
    const types = type ? [type] : agentFactory.getAvailableTypes();
    const results: any[] = [];

    // Resolve working directory: use worktree path if provided, else current process cwd
    let cwd = process.cwd();
    if (worktreeId) {
      const gitService = (req.app as any).locals?.gitService;
      const worktree = gitService?.getWorktree?.(worktreeId);
      if (worktree?.path) {
        cwd = worktree.path;
      }
    }

    for (const t of types) {
      const info = await agentFactory.getAgentInfoById(t as any);
      if (!info?.isAvailable) {
        results.push({ type: t, ok: false, reason: 'not_available', info });
        continue;
      }
      if (info.isAuthenticated === false) {
        results.push({ type: t, ok: false, reason: 'not_authenticated', info });
        continue;
      }

      let pty: IPty | null = null;
      let output = '';
      const verifyTimeout = Math.max(1000, Math.min(Number(timeoutMs) || 2500, 10000));
      try {
        pty = await agentFactory.startAgent(t as any, cwd);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), verifyTimeout);
          pty!.onData((d: string) => {
            output += d;
            if (output.length > 5000) output = output.slice(-3000);
          });
          // Short settle period to collect some output then resolve
          setTimeout(() => resolve(), Math.min(verifyTimeout, 1200));
        });
        // Attempt a clean kill
        try { pty?.kill(); } catch {}
        results.push({ type: t, ok: true, outputPreview: output.slice(0, 400), info });
      } catch (error: any) {
        try { pty?.kill(); } catch {}
        results.push({ type: t, ok: false, error: String(error?.message || error), info });
      }
    }

    res.json({ cwd, results });
  });

  return router;
}
