import { useState, useEffect } from 'react';
import { Routes, Route, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Repository, ClaudeInstance, Worktree, AgentType } from './types';
import { api } from './api';
import { RepositoryPanel } from './components/RepositoryPanel';
import { AgentPanel } from './components/AgentPanel';
import { DatabaseManager } from './components/DatabaseManager';
import { AuthButton } from './components/AuthButton';
import { SettingsMenu } from './components/SettingsMenu';
import { WebSocketDebugPanel } from './components/WebSocketDebugPanel';
import { RepositoryDashboardPanel } from './components/RepositoryDashboardPanel';
import { useCheatCode } from './contexts/CheatCodeContext';
import { getAppConfig } from './config/app.config';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/database" element={<DatabaseRoute />} />
    </Routes>
  );
}

function DatabaseRoute() {
  const { isDatabaseUnlocked } = useCheatCode();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDatabaseUnlocked) {
      navigate('/');
    }
  }, [isDatabaseUnlocked, navigate]);

  if (!isDatabaseUnlocked) {
    return null;
  }

  return <DatabaseManager />;
}

function MainApp() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDatabaseUnlocked } = useCheatCode();
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [instances, setInstances] = useState<ClaudeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [appName, setAppName] = useState('Bob');
  const [enableGithubAuth, setEnableGithubAuth] = useState(false);

  useEffect(() => {
    // Load app config first
    getAppConfig().then(config => {
      setAppName(config.appName);
      setEnableGithubAuth(config.enableGithubAuth);
    });

    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle URL parameters for direct worktree and repository linking
  useEffect(() => {
    const worktreeParam = searchParams.get('worktree');
    const repositoryParam = searchParams.get('repository');

    // Handle repository selection
    if (repositoryParam) {
      if (repositories.length > 0) {
        const targetRepo = repositories.find(r => r.id === repositoryParam);
        if (targetRepo && selectedRepositoryId !== repositoryParam) {
          handleSelectRepository(repositoryParam);
        } else if (!targetRepo && selectedRepositoryId) {
          setSelectedRepositoryId(null);
        }
      }
      return; // Repository takes precedence over worktree
    }

    // Handle worktree selection
    if (worktreeParam) {
      if (repositories.length > 0) {
        const allWorktrees = repositories.flatMap(repo => repo.worktrees);
        const targetWorktree = allWorktrees.find(w => w.id === worktreeParam);

        if (targetWorktree && selectedWorktreeId !== worktreeParam) {
          handleSelectWorktree(targetWorktree.id);
        } else if (!targetWorktree && selectedWorktreeId) {
          setSelectedWorktreeId(null);
        }
      }
      return;
    }

    // No params - clear selections
    if (selectedWorktreeId) {
      setSelectedWorktreeId(null);
    }
    if (selectedRepositoryId) {
      setSelectedRepositoryId(null);
    }
  }, [repositories, searchParams]);

  const loadData = async () => {
    try {
      const [reposData, instancesData] = await Promise.all([
        api.getRepositories(),
        api.getInstances()
      ]);
      
      setRepositories(reposData);
      setInstances(instancesData);
      setError(null);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRepository = async (repositoryPath: string) => {
    try {
      await api.addRepository(repositoryPath);
      await loadData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    }
  };

  const handleCreateWorktreeAndStartInstance = async (repositoryId: string, branchName: string, agentType?: AgentType) => {
    try {
      const worktree = await api.createWorktree(repositoryId, branchName);
      await api.startInstance(worktree.id, agentType);
      await loadData();
      setSelectedWorktreeId(worktree.id);
      setError(null);
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create worktree and start instance');
      // Clear error after 10 seconds
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleRefreshMainBranch = async (repositoryId: string) => {
    try {
      await api.refreshMainBranch(repositoryId);
      await loadData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh main branch');
    }
  };

  const handleCreateTerminalSession = async (instanceId: string): Promise<string> => {
    try {
      const { sessionId } = await api.createTerminalSession(instanceId);
      setInstanceError(null);
      return sessionId;
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create terminal session');
      setTimeout(() => setInstanceError(null), 10000);
      throw err;
    }
  };

  const handleCreateDirectoryTerminalSession = async (instanceId: string): Promise<string> => {
    try {
      const { sessionId } = await api.createDirectoryTerminalSession(instanceId);
      setInstanceError(null);
      return sessionId;
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to create directory terminal session');
      setTimeout(() => setInstanceError(null), 10000);
      throw err;
    }
  };

  const handleCloseTerminalSession = async (sessionId: string) => {
    try {
      await api.closeTerminalSession(sessionId);
    } catch (err) {
      console.error('Failed to close terminal session:', err);
    }
  };

  const handleRestartInstance = async (instanceId: string) => {
    try {
      await api.restartInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to restart instance');
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleStopInstance = async (instanceId: string) => {
    try {
      await api.stopInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : 'Failed to stop instance');
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleDeleteWorktree = async (worktreeId: string, force: boolean) => {
    try {
      await api.removeWorktree(worktreeId, force);
      await loadData();
      
      // If the deleted worktree was selected, clear the selection
      if (selectedWorktreeId === worktreeId) {
        setSelectedWorktreeId(null);
      }
      
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree');
      throw err; // Re-throw so the modal can handle it
    }
  };

  const handleSelectWorktree = async (worktreeId: string) => {
    setSelectedWorktreeId(worktreeId);
    setSelectedRepositoryId(null); // Clear repository selection

    // Update URL to reflect selected worktree
    setSearchParams({ worktree: worktreeId });

    // Just refresh data to show current state - don't auto-start instances
    await loadData();
  };

  const handleSelectRepository = (repositoryId: string) => {
    setSelectedRepositoryId(repositoryId);
    setSelectedWorktreeId(null); // Clear worktree selection

    // Update URL to reflect selected repository
    setSearchParams({ repository: repositoryId });
  };

  const toggleLeftPanel = () => {
    setIsLeftPanelCollapsed(prev => !prev);
  };

  // Get selected worktree and instance
  const selectedWorktree: Worktree | null = repositories
    .flatMap(repo => repo.worktrees)
    .find(worktree => worktree.id === selectedWorktreeId) || null;

  const selectedInstance: ClaudeInstance | null = selectedWorktree
    ? instances.find(instance => instance.worktreeId === selectedWorktree.id) || null
    : null;

  // Get selected repository
  const selectedRepository: Repository | null = repositories.find(repo => repo.id === selectedRepositoryId) || null;

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }


  return (
    <div className="container">
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <h1
              onClick={() => {
                setSelectedWorktreeId(null);
                setSearchParams({});
                navigate('/');
              }}
              style={{
                cursor: 'pointer',
                transition: 'color 0.2s ease',
                margin: 20,
              }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.color = '#58a6ff'}
              onMouseLeave={(e) => (e.target as HTMLElement).style.color = ''}
            >
              {appName}
            </h1>
            {isDatabaseUnlocked && (
              <nav style={{ display: 'flex', gap: '16px' }}>
                <button
                  onClick={() => navigate('/database')}
                  className={`nav-button ${location.pathname === '/database' ? 'active' : ''}`}
                >
                  Database
                </button>
              </nav>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {import.meta.env.DEV && <WebSocketDebugPanel />}
            <SettingsMenu />
            {enableGithubAuth && <AuthButton />}
          </div>
        </div>
      </div>

      <div className="main-layout">
        <RepositoryPanel
          repositories={repositories}
          instances={instances}
          selectedWorktreeId={selectedWorktreeId}
          selectedRepositoryId={selectedRepositoryId}
          onAddRepository={handleAddRepository}
          onCreateWorktreeAndStartInstance={handleCreateWorktreeAndStartInstance}
          onSelectWorktree={handleSelectWorktree}
          onSelectRepository={handleSelectRepository}
          onDeleteWorktree={handleDeleteWorktree}
          onRefreshMainBranch={handleRefreshMainBranch}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={toggleLeftPanel}
        />

        {selectedRepository ? (
          <RepositoryDashboardPanel
            repository={selectedRepository}
            isLeftPanelCollapsed={isLeftPanelCollapsed}
          />
        ) : (
          <AgentPanel
            selectedWorktree={selectedWorktree}
            selectedInstance={selectedInstance}
            onCreateTerminalSession={handleCreateTerminalSession}
            onCreateDirectoryTerminalSession={handleCreateDirectoryTerminalSession}
            onCloseTerminalSession={handleCloseTerminalSession}
            onRestartInstance={handleRestartInstance}
            onStopInstance={handleStopInstance}
            onDeleteWorktree={handleDeleteWorktree}
            error={instanceError}
            isLeftPanelCollapsed={isLeftPanelCollapsed}
          />
        )}
      </div>
    </div>
  );
}

export default App;
