import { Router } from 'express';
import { agentFactory } from '../agents/agent-factory.js';
import { IPty } from 'node-pty';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Agent config file locations
const AGENT_CONFIG_PATHS: Record<string, { dir: string; files: string[] }> = {
  claude: {
    dir: '.claude',
    files: ['settings.json', 'settings.local.json', 'config.json']
  },
  gemini: {
    dir: '.gemini',
    files: ['settings.json', 'config.json']
  },
  opencode: {
    dir: '.opencode',
    files: ['config.json', 'settings.json']
  },
  kiro: {
    dir: '.kiro',
    files: ['settings.json', 'config.json']
  },
  codex: {
    dir: '.codex',
    files: ['config.json', 'settings.json']
  }
};

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

    let cwd = process.cwd();
    if (worktreeId) {
      const gitService = (req.app as any).locals?.gitService;
      const worktree = gitService?.getWorktree?.(worktreeId, req.userId);
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

  // Get agent config files list
  router.get('/:type/config', async (req, res) => {
    try {
      const agentType = req.params.type;
      const configInfo = AGENT_CONFIG_PATHS[agentType];
      
      if (!configInfo) {
        return res.status(404).json({ error: `Unknown agent type: ${agentType}` });
      }
      
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, configInfo.dir);
      
      const files: Array<{ name: string; path: string; exists: boolean; content?: string }> = [];
      
      // Check for known config files
      for (const fileName of configInfo.files) {
        const filePath = path.join(configDir, fileName);
        const exists = fs.existsSync(filePath);
        let content: string | undefined;
        
        if (exists) {
          try {
            content = fs.readFileSync(filePath, 'utf-8');
          } catch (e) {
            // File exists but couldn't be read
          }
        }
        
        files.push({
          name: fileName,
          path: filePath,
          exists,
          content
        });
      }
      
      // Also scan for any other JSON files in the config directory
      if (fs.existsSync(configDir)) {
        try {
          const allFiles = fs.readdirSync(configDir);
          for (const fileName of allFiles) {
            if (fileName.endsWith('.json') && !configInfo.files.includes(fileName)) {
              const filePath = path.join(configDir, fileName);
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                let content: string | undefined;
                try {
                  content = fs.readFileSync(filePath, 'utf-8');
                } catch (e) {}
                
                files.push({
                  name: fileName,
                  path: filePath,
                  exists: true,
                  content
                });
              }
            }
          }
        } catch (e) {
          // Directory exists but couldn't be read
        }
      }
      
      res.json({
        agentType,
        configDir,
        files
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get agent config', details: String(error) });
    }
  });

  // Save agent config file
  router.put('/:type/config/:fileName', async (req, res) => {
    try {
      const { type: agentType, fileName } = req.params;
      const { content } = req.body;
      
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content must be a string' });
      }
      
      // Validate JSON
      try {
        JSON.parse(content);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON content' });
      }
      
      const configInfo = AGENT_CONFIG_PATHS[agentType];
      if (!configInfo) {
        return res.status(404).json({ error: `Unknown agent type: ${agentType}` });
      }
      
      // Security: only allow known file names or .json files
      if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Only JSON files are allowed' });
      }
      
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, configInfo.dir);
      const filePath = path.join(configDir, fileName);
      
      // Ensure the config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Write the file
      fs.writeFileSync(filePath, content, 'utf-8');
      
      res.json({
        message: 'Config saved successfully',
        path: filePath
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save agent config', details: String(error) });
    }
  });

  // Create new config file
  router.post('/:type/config', async (req, res) => {
    try {
      const { type: agentType } = req.params;
      const { fileName, content } = req.body;
      
      if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ error: 'fileName is required' });
      }
      
      if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Only JSON files are allowed' });
      }
      
      // Validate JSON if content provided
      const fileContent = content || '{}';
      try {
        JSON.parse(fileContent);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON content' });
      }
      
      const configInfo = AGENT_CONFIG_PATHS[agentType];
      if (!configInfo) {
        return res.status(404).json({ error: `Unknown agent type: ${agentType}` });
      }
      
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, configInfo.dir);
      const filePath = path.join(configDir, fileName);
      
      // Ensure the config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Check if file already exists
      if (fs.existsSync(filePath)) {
        return res.status(409).json({ error: 'File already exists' });
      }
      
      // Write the file
      fs.writeFileSync(filePath, fileContent, 'utf-8');
      
      res.json({
        message: 'Config file created successfully',
        path: filePath
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create config file', details: String(error) });
    }
  });

  // Delete config file
  router.delete('/:type/config/:fileName', async (req, res) => {
    try {
      const { type: agentType, fileName } = req.params;
      
      const configInfo = AGENT_CONFIG_PATHS[agentType];
      if (!configInfo) {
        return res.status(404).json({ error: `Unknown agent type: ${agentType}` });
      }
      
      if (!fileName.endsWith('.json')) {
        return res.status(400).json({ error: 'Only JSON files are allowed' });
      }
      
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, configInfo.dir);
      const filePath = path.join(configDir, fileName);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      fs.unlinkSync(filePath);
      
      res.json({
        message: 'Config file deleted successfully'
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete config file', details: String(error) });
    }
  });

  return router;
}
