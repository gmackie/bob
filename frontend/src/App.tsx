import { useState, useEffect } from 'react';
import { Routes, Route, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Repository, ClaudeInstance, Worktree, AgentInfo, AgentType } from './types';
import { api } from './api';
import { RepositoryPanel } from './components/RepositoryPanel';
import { AgentPanel } from './components/AgentPanel';
import { DatabaseManager } from './components/DatabaseManager';
import { useCheatCode } from './contexts/CheatCodeContext';

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
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const defaultAgentType: AgentType | undefined = (() => {
    const ready = agents.filter(a => a.isAvailable && (a.isAuthenticated ?? true));
    const claude = ready.find(a => a.type === 'claude');
    return claude?.type || ready[0]?.type;
  })();

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle URL parameters for direct worktree linking
  useEffect(() => {
    const worktreeParam = searchParams.get('worktree');

    if (!worktreeParam) {
      // No worktree in URL, ensure nothing is selected
      if (selectedWorktreeId) {
        setSelectedWorktreeId(null);
      }
      return;
    }

    if (repositories.length > 0) {
      // Find worktree by ID
      const allWorktrees = repositories.flatMap(repo => repo.worktrees);
      const targetWorktree = allWorktrees.find(w => w.id === worktreeParam);

      if (targetWorktree && selectedWorktreeId !== worktreeParam) {
        // Only select if it's different from current selection
        handleSelectWorktree(targetWorktree.id);
      } else if (!targetWorktree && selectedWorktreeId) {
        // Worktree not found, clear selection
        setSelectedWorktreeId(null);
      }
    }
  }, [repositories, searchParams]);

  const loadData = async () => {
    try {
      const [reposData, instancesData, agentsData] = await Promise.all([
        api.getRepositories(),
        api.getInstances(),
        api.getAgents().catch(() => [])
      ]);
      
      setRepositories(reposData);
      setInstances(instancesData);
      setAgents(agentsData as AgentInfo[]);
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

  const handleStartInstance = async (worktreeId: string, agentType?: AgentType) => {
    try {
      await api.startInstance(worktreeId, agentType);
      await loadData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start instance');
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

    // Update URL to reflect selected worktree
    setSearchParams({ worktree: worktreeId });

    // Get fresh instance data directly from API to avoid stale state
    try {
      const freshInstances = await api.getInstances();
      const existingInstance = freshInstances.find(instance => instance.worktreeId === worktreeId);

      if (existingInstance) {
        // If instance exists but is stopped/error, restart it
        if (existingInstance.status === 'stopped' || existingInstance.status === 'error') {
          try {
            await handleRestartInstance(existingInstance.id);
            // handleRestartInstance already calls loadData(), so no need to call it again
            return;
          } catch (error) {
            console.error('Failed to restart instance when selecting worktree:', error);
          }
        }
        // If it's running or starting, do nothing - instance is already active
      } else {
        // No instance exists, create a new one
        try {
          await handleStartInstance(worktreeId, defaultAgentType);
          // handleStartInstance already calls loadData(), so no need to call it again
          return;
        } catch (error) {
          console.error('Failed to start instance when selecting worktree:', error);
        }
      }
    } catch (error) {
      console.error('Failed to get fresh instance data:', error);
    }

    // Only refresh if no instance operations were performed
    await loadData();
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
              Bob
            </h1>
            <nav style={{ display: 'flex', gap: '16px' }}>
              <button
                onClick={() => navigate('/')}
                className={`nav-button ${location.pathname === '/' ? 'active' : ''}`}
              >
                Home
              </button>
              {isDatabaseUnlocked && (
                <button
                  onClick={() => navigate('/database')}
                  className={`nav-button ${location.pathname === '/database' ? 'active' : ''}`}
                >
                  Database
                </button>
              )}
            </nav>
          </div>
        </div>
      </div>

      <div className="main-layout">
        <RepositoryPanel
          repositories={repositories}
          instances={instances}
          selectedWorktreeId={selectedWorktreeId}
          onAddRepository={handleAddRepository}
          onCreateWorktreeAndStartInstance={handleCreateWorktreeAndStartInstance}
          onSelectWorktree={handleSelectWorktree}
          onDeleteWorktree={handleDeleteWorktree}
          onRefreshMainBranch={handleRefreshMainBranch}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={toggleLeftPanel}
          agents={agents}
        />
        
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
      </div>
    </div>
  );
}

export default App;
