import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn } from 'lucide-react';

interface RequireAuthProps {
  children: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-center">
          <div className="text-gray-400 mb-2">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const handleLogin = () => {
      const apiBase = import.meta.env.MODE === 'production' && import.meta.env.VITE_API_URL
        ? import.meta.env.VITE_API_URL
        : '';
      window.location.href = `${apiBase}/api/auth/github`;
    };

    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Bob Development Tool</h1>
            <p className="text-gray-400 mb-8">Authentication required to continue</p>

            <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-4 mb-6">
              <p className="text-yellow-200 text-sm">
                Access is restricted to authorized users only.
              </p>
            </div>

            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              <LogIn className="h-5 w-5" />
              <span className="font-medium">Login with GitHub</span>
            </button>

            <p className="text-gray-500 text-xs mt-4">
              Only whitelisted GitHub accounts can access this application
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};