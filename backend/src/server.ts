import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import session from 'express-session';
import passport from 'passport';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GitService } from './services/git.js';
import { AgentService } from './services/agent.js';
import { TerminalService } from './services/terminal.js';
import { AuthService } from './services/auth.js';
import { DatabaseService } from './database/database.js';
import { createRepositoryRoutes } from './routes/repositories.js';
import { createInstanceRoutes } from './routes/instances.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import { createDatabaseRoutes } from './routes/database.js';
import { createAuthRoutes, requireAuth } from './routes/auth.js';
import gitRoutes from './routes/git.js';
import { createAgentsRoutes } from './routes/agents.js';
import { agentFactory } from './agents/agent-factory.js';
import { appConfig } from './config/app.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = parseInt(process.env.PORT || '43829', 10);

// Configure CORS with specific origins
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowedOrigins = [
      'http://localhost:47285',
      'http://localhost:5173',
      'http://127.0.0.1:47285',
      'http://127.0.0.1:5173',
      'https://claude.gmac.io'
    ];

    // Add production frontend URL if configured
    if (process.env.FRONTEND_URL) {
      allowedOrigins.push(process.env.FRONTEND_URL);
    }

    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Initialize database
const db = new DatabaseService();
await db.waitForInit();
console.log('Database initialized');

// Initialize services
const gitService = new GitService(db);
const agentService = new AgentService(gitService, db);
const terminalService = new TerminalService();
const authService = new AuthService(db);

console.log('Services initialized');

// Auth routes (conditionally enabled)
if (appConfig.enableGithubAuth) {
  app.use('/api/auth', createAuthRoutes(authService));
}

// Health check endpoint (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// App config endpoint (public)
app.get('/api/config', (req, res) => {
  res.json({
    appName: appConfig.getAppName(),
    enableGithubAuth: appConfig.enableGithubAuth,
    jeffMode: appConfig.jeffMode,
    allowedAgents: appConfig.getAllowedAgents()
  });
});

// Require authentication for all other API routes (only if auth is enabled)
if (appConfig.enableGithubAuth) {
  app.use('/api', requireAuth(authService));
}

app.use('/api/repositories', createRepositoryRoutes(gitService, agentService));
app.use('/api/instances', createInstanceRoutes(agentService, terminalService, gitService));
app.use('/api/agents', createAgentsRoutes());
app.use('/api/filesystem', createFilesystemRoutes());
app.use('/api/database', createDatabaseRoutes(db));

// Make services available to git routes
app.locals.gitService = gitService;
app.locals.agentService = agentService;
app.locals.databaseService = db;
app.locals.authService = authService;
app.use('/api/git', gitRoutes);

app.get('/api/system-status', async (req, res) => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Collect agent statuses via factory
    const agents = await agentFactory.getAgentInfo();

    // Back-compat: expose a top-level `claude` status alongside agents array
    const claudeInfo = agents.find(a => a.type === 'claude');
    const claude = {
      status: claudeInfo ? (claudeInfo.isAvailable ? 'available' : 'not_available') : 'unknown',
      version: claudeInfo?.version || ''
    };

    // Check GitHub CLI availability
    let githubStatus = 'unknown';
    let githubVersion = '';
    let githubUser = '';
    try {
      const { stdout: versionOut } = await execAsync('gh --version');
      githubVersion = versionOut.split('\n')[0]?.trim() || '';
      githubStatus = 'available';

      try {
        const { stdout: userOut } = await execAsync('gh api user --jq .login');
        githubUser = userOut.trim();
      } catch (userError) {
        githubStatus = 'not_authenticated';
      }
    } catch (error) {
      githubStatus = 'not_available';
    }

    // Get system metrics
    const gitService = req.app.locals.gitService;
    const agentService = req.app.locals.agentService;

    const repositories = gitService.getRepositories();
    // Count only actual worktrees (exclude main working trees)
    const totalWorktrees = repositories.reduce((count: number, repo: any) => {
      const actualWorktrees = repo.worktrees.filter((worktree: any) => !worktree.isMainWorktree);
      return count + actualWorktrees.length;
    }, 0);
    const instances = agentService.getInstances();
    const activeInstances = instances.filter((i: any) => i.status === 'running' || i.status === 'starting').length;

    res.json({
      agents,
      claude,
      github: {
        status: githubStatus,
        version: githubVersion,
        user: githubUser
      },
      metrics: {
        repositories: repositories.length,
        worktrees: totalWorktrees,
        totalInstances: instances.length,
        activeInstances: activeInstances
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      }
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Serve static files from frontend build (only in production)
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));

  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  // In development, just show a message for non-API routes
  app.get('*', (req, res) => {
    res.json({
      message: 'Bob backend running in development mode',
      frontend: 'http://localhost:47285',
      api: `http://localhost:${PORT}/api`
    });
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    ws.close(1000, 'Session ID required');
    return;
  }

  console.log(`WebSocket connection for terminal session: ${sessionId}`);
  terminalService.attachWebSocket(sessionId, ws);
});

const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  
  await agentService.cleanup();
  terminalService.cleanup();
  db.close();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Bind address: 0.0.0.0 in Docker (for container networking), 127.0.0.1 otherwise
const BIND_ADDRESS = process.env.DOCKER_ENV === 'true' ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Bob server running on ${BIND_ADDRESS}:${PORT}`);
  console.log(`WebSocket server ready for terminal connections`);
});

export { app, server };
