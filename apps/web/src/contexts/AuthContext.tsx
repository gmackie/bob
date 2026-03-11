"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

import { getApiBase } from "~/lib/legacy/config";

interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const apiBase = getApiBase();

      console.log("Auth check - API Base:", apiBase);
      console.log("Auth check - Token:", token ? "present" : "missing");

      const url = `${apiBase}/api/auth/status`;
      console.log("Auth check - Full URL:", url);

      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      console.log("Auth check - Response status:", response.status);

      const data = await response.json();
      console.log("Auth check - Response data:", data);

      setIsAuthenticated(data.authenticated);
      setUser(data.authenticated ? data.user : null);
    } catch (error) {
      console.error("Auth check failed:", error);
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Handle OAuth callback BEFORE checking auth
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth");
    const token = params.get("token");

    console.log("AuthProvider - URL params:", window.location.search);
    console.log("AuthProvider - Auth result:", authResult);
    console.log("AuthProvider - Token:", token);

    if (authResult === "success" && token) {
      console.log("AuthProvider - Storing token and checking auth");
      // Store token and clean URL
      localStorage.setItem("authToken", token);
      window.history.replaceState({}, document.title, window.location.pathname);
      // checkAuth will be called after this effect
    } else if (authResult === "failed") {
      // Clean URL on failure
      window.history.replaceState({}, document.title, window.location.pathname);
      alert("Authentication failed. Please try again.");
    } else if (authResult === "unauthorized") {
      // User not on whitelist
      window.history.replaceState({}, document.title, window.location.pathname);
      alert("Access denied. You are not authorized to use this application.");
    }

    // Always check auth after handling OAuth callback
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, user, checkAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
};
