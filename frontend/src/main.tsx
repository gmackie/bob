import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { CheatCodeProvider } from './contexts/CheatCodeContext.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { RequireAuth } from './components/RequireAuth.tsx'
import { getAppConfig } from './config/app.config.ts'
import './index.css'

// Wrapper component that conditionally applies auth based on config
function AppWrapper() {
  const [enableGithubAuth, setEnableGithubAuth] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAppConfig().then(config => {
      setEnableGithubAuth(config.enableGithubAuth);
      setIsLoading(false);
    }).catch(() => {
      // If config fetch fails, default to no auth to prevent lockout
      setEnableGithubAuth(false);
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // If auth is disabled, bypass RequireAuth and AuthProvider entirely
  if (!enableGithubAuth) {
    return (
      <CheatCodeProvider>
        <App />
      </CheatCodeProvider>
    );
  }

  // If auth is enabled, use the full auth flow
  return (
    <AuthProvider>
      <RequireAuth>
        <CheatCodeProvider>
          <App />
        </CheatCodeProvider>
      </RequireAuth>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppWrapper />
    </BrowserRouter>
  </React.StrictMode>,
)