import { Router } from 'express';
import { GitService } from '../services/git.js';
import { AgentService } from '../services/agent.js';
import { CreateWorktreeRequest } from '../types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { listRepositoryDocs, readRepositoryDoc } from '../utils/repositoryDocs.js';

export function createRepositoryRoutes(gitService: GitService, agentService: AgentService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const repositories = gitService.getRepositories();
      res.json(repositories);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get repositories' });
    }
  });

  router.post('/add', async (req, res) => {
    try {
      const { repositoryPath } = req.body;
      if (!repositoryPath) {
        return res.status(400).json({ error: 'repositoryPath is required' });
      }

      const repository = await gitService.addRepository(repositoryPath);
      res.status(201).json(repository);
    } catch (error) {
      res.status(500).json({ error: `Failed to add repository: ${error}` });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      res.json(repository);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get repository' });
    }
  });

  router.get('/:id/worktrees', (req, res) => {
    try {
      const worktrees = gitService.getWorktreesByRepository(req.params.id);
      res.json(worktrees);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get worktrees' });
    }
  });

  router.post('/:id/refresh-main', async (req, res) => {
    try {
      const repository = await gitService.refreshMainBranch(req.params.id);
      res.json(repository);
    } catch (error) {
      res.status(500).json({ error: `Failed to refresh main branch: ${error}` });
    }
  });

  router.post('/:id/worktrees', async (req, res) => {
    try {
      const { branchName, baseBranch, agentType } = req.body as CreateWorktreeRequest;

      if (!branchName) {
        return res.status(400).json({ error: 'branchName is required' });
      }

      const worktree = await gitService.createWorktree(req.params.id, branchName, baseBranch, agentType);
      res.status(201).json(worktree);
    } catch (error) {
      res.status(500).json({ error: `Failed to create worktree: ${error}` });
    }
  });

  router.get('/worktrees/:worktreeId/merge-status', async (req, res) => {
    try {
      const mergeStatus = await gitService.checkBranchMergeStatus(req.params.worktreeId);
      res.json(mergeStatus);
    } catch (error) {
      res.status(500).json({ error: `Failed to check merge status: ${error}` });
    }
  });

  router.delete('/worktrees/:worktreeId', async (req, res) => {
    try {
      const force = req.query.force === 'true';
      const worktreeId = req.params.worktreeId;
      
      // If force delete, stop all instances first
      if (force) {
        const instances = agentService.getInstancesByWorktree(worktreeId);
        for (const instance of instances) {
          if (instance.status === 'running' || instance.status === 'starting') {
            console.log(`Force delete: stopping instance ${instance.id} (${instance.agentType}) for worktree ${worktreeId}`);
            await agentService.stopInstance(instance.id);
          }
        }
        
        // Wait a moment for instances to fully stop and update worktree instances status
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh the worktree to get updated instance statuses
        const worktree = gitService.getWorktree(worktreeId);
        if (worktree) {
          // Update instances from claude service
          const updatedInstances = agentService.getInstancesByWorktree(worktreeId);
          worktree.instances = updatedInstances;
        }
      }
      
      await gitService.removeWorktree(worktreeId, force);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: `Failed to remove worktree: ${error}` });
    }
  });

  // -------- Repository Dashboard Endpoints --------
  router.get('/:id/remotes', async (req, res) => {
    try {
      const remotes = await gitService.getGitRemotes(req.params.id);
      res.json(remotes);
    } catch (error) {
      res.status(500).json({ error: `Failed to get remotes: ${error}` });
    }
  });

  router.get('/:id/branches', async (req, res) => {
    try {
      const branches = await gitService.getGitBranches(req.params.id);
      res.json(branches);
    } catch (error) {
      res.status(500).json({ error: `Failed to get branches: ${error}` });
    }
  });

  router.get('/:id/graph', async (req, res) => {
    try {
      const graph = await gitService.getGitGraph(req.params.id);
      res.json(graph);
    } catch (error) {
      res.status(500).json({ error: `Failed to get git graph: ${error}` });
    }
  });

  router.get('/:id/notes', async (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      const notesPath = path.join(repository.path, 'docs', 'notes', '.bob-repo.md');
      try {
        const content = await fs.readFile(notesPath, 'utf-8');
        res.set('Content-Type', 'text/plain');
        return res.send(content);
      } catch (readErr: any) {
        if (readErr && readErr.code === 'ENOENT') {
          return res.status(404).send('');
        }
        throw readErr;
      }
    } catch (error) {
      res.status(500).json({ error: `Failed to get project notes: ${error}` });
    }
  });

  router.post('/:id/notes', async (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      const { notes } = req.body as { notes?: string };
      if (typeof notes !== 'string') {
        return res.status(400).json({ error: 'notes must be a string' });
      }
      const notesDir = path.join(repository.path, 'docs', 'notes');
      const notesPath = path.join(notesDir, '.bob-repo.md');
      await fs.mkdir(notesDir, { recursive: true });
      await fs.writeFile(notesPath, notes, 'utf-8');
      return res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: `Failed to save project notes: ${error}` });
    }
  });

  // -------- Repository Docs Endpoints --------
  router.get('/:id/docs', async (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const list = await listRepositoryDocs(repository.path);
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: `Failed to list docs: ${error}` });
    }
  });

  router.get('/:id/docs/content', async (req, res) => {
    try {
      const repository = gitService.getRepository(req.params.id);
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });

      const content = await readRepositoryDoc(repository.path, rel);
      res.set('Content-Type', 'text/plain');
      res.send(content);
    } catch (error) {
      res.status(500).json({ error: `Failed to read doc content: ${error}` });
    }
  });

  return router;
}
