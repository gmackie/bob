import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { LogOut, LogIn } from 'lucide-react';

export const AuthButton: React.FC = () => {
  const { isAuthenticated, isLoading, user, checkAuth } = useAuth();


  const getApiBase = () => {
    return import.meta.env.MODE === 'production' && import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL
      : '';
  };

  const handleLogin = () => {
    const apiBase = getApiBase();
    window.location.href = `${apiBase}/api/auth/github`;
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`${getApiBase()}/api/auth/logout`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      localStorage.removeItem('authToken');
      await checkAuth();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-gray-500">
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-2">
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: '#4B5563'
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              {user.username?.substring(0, 2).toUpperCase()}
            </div>
          )}
        </div>
        <span className="text-sm text-gray-300 hidden sm:inline">
          {user.username}
        </span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors ml-1"
          title="Logout"
        >
          <LogOut className="h-3 w-3" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLogin}
      className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
    >
      <LogIn className="h-4 w-4" />
      <span className="text-sm">Login with GitHub</span>
    </button>
  );
};