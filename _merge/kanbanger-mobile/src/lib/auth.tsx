import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useEnvironment } from "./environment";

const SESSION_KEY = "session_token";
const BETA_USER_KEY = "beta_user_id";
const APP_SCHEME = __DEV__ ? "kanbanger-dev" : "kanbanger";

interface AuthContextValue {
  userId: string | null;
  isSignedIn: boolean;
  isLoading: boolean;
  getToken: () => Promise<string | null>;
  signIn: (provider: "entra" | "github" | "gitea") => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { config, environment, isLoading: envLoading } = useEnvironment();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const apiUrl = config.apiUrl;

  useEffect(() => {
    if (envLoading) return;

    const loadAuth = async () => {
      setIsLoading(true);
      const useBetaAuth = !config.authRequired;
      console.log("[Auth] Loading, authRequired:", config.authRequired, "useBetaAuth:", useBetaAuth);
      
      if (useBetaAuth) {
        const betaUserId = await SecureStore.getItemAsync(BETA_USER_KEY);
        if (betaUserId && betaUserId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          console.log("[Auth] Using stored beta user:", betaUserId);
          setUserId(betaUserId);
          setIsLoading(false);
          return;
        }
        if (betaUserId) {
          console.log("[Auth] Clearing invalid stored beta user:", betaUserId);
          await SecureStore.deleteItemAsync(BETA_USER_KEY);
        }
        try {
          console.log("[Auth] Fetching beta session from:", `${apiUrl}/api/trpc/auth.session`);
          const startTime = Date.now();
          const response = await fetch(`${apiUrl}/api/trpc/auth.session`, {
            headers: { "x-beta-auth-bypass": "true" },
          });
          console.log("[Auth] Response status:", response.status, "took:", Date.now() - startTime, "ms");
          const data = await response.json() as { result?: { data?: { json?: { user?: { id: string; email?: string } } } } };
          console.log("[Auth] Response data:", JSON.stringify(data, null, 2));
          const user = data.result?.data?.json?.user;
          if (user?.id) {
            console.log("[Auth] Beta user authenticated:", user.id, "email:", user.email);
            setUserId(user.id);
            await SecureStore.setItemAsync(BETA_USER_KEY, user.id);
          } else {
            console.log("[Auth] No user in response, data structure:", Object.keys(data));
          }
        } catch (e) {
          console.log("[Auth] Beta auth error:", e);
        }
        setIsLoading(false);
        return;
      }

      const token = await SecureStore.getItemAsync(SESSION_KEY);
      if (token) {
        setSessionToken(token);
        await validateSession(token);
      } else {
        setIsLoading(false);
      }
    };

    loadAuth();
  }, [environment, envLoading, config.authRequired, apiUrl]);

  const validateSession = async (token: string) => {
    try {
      console.log("[Auth] Validating session token...");
      const response = await fetch(`${apiUrl}/api/trpc/auth.session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await response.json() as { result?: { data?: { json?: { user?: { id: string; email?: string } } } } };
      console.log("[Auth] Session response:", response.status, JSON.stringify(data).slice(0, 200));
      const user = data.result?.data?.json?.user;
      if (user?.id) {
        console.log("[Auth] Session valid, userId:", user.id, "email:", user.email);
        setUserId(user.id);
      } else {
        console.log("[Auth] No user in session response, clearing token");
        await SecureStore.deleteItemAsync(SESSION_KEY);
        setSessionToken(null);
      }
    } catch (e) {
      console.log("[Auth] Session validation error:", e);
      await SecureStore.deleteItemAsync(SESSION_KEY);
      setSessionToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const getToken = useCallback(async () => {
    return sessionToken;
  }, [sessionToken]);

  const signIn = useCallback(async (provider: "entra" | "github" | "gitea") => {
    if (!config.authRequired) {
      try {
        const response = await fetch(`${apiUrl}/api/trpc/auth.session`, {
          headers: { "x-beta-auth-bypass": "true" },
        });
        const data = await response.json() as { result?: { data?: { json?: { user?: { id: string } } } } };
        const user = data.result?.data?.json?.user;
        if (user?.id) {
          console.log("[Auth] Beta sign in:", user.id);
          setUserId(user.id);
          await SecureStore.setItemAsync(BETA_USER_KEY, user.id);
        }
      } catch (e) {
        console.error("[Auth] Beta sign in error:", e);
      }
      return;
    }

    const redirectScheme = `${APP_SCHEME}://auth-callback`;
    const returnUrl = encodeURIComponent(`${apiUrl}/api/auth/mobile-callback?redirect=${encodeURIComponent(redirectScheme)}`);
    const authUrl = `${apiUrl}/api/auth/${provider}?returnUrl=${returnUrl}`;
    
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectScheme);
    
    if (result.type === "success" && result.url) {
      const url = new URL(result.url);
      const token = url.searchParams.get("session_token");
      if (token) {
        await SecureStore.setItemAsync(SESSION_KEY, token);
        setSessionToken(token);
        await validateSession(token);
      }
    }
  }, [apiUrl, config.authRequired]);

  const signOut = useCallback(async () => {
    if (sessionToken && config.authRequired) {
      try {
        await fetch(`${apiUrl}/api/trpc/auth.logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${sessionToken}` },
        });
      } catch {}
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(BETA_USER_KEY);
    setSessionToken(null);
    setUserId(null);
  }, [sessionToken, apiUrl, config.authRequired]);

  return (
    <AuthContext.Provider
      value={{
        userId,
        isSignedIn: !!userId,
        isLoading: isLoading || envLoading,
        getToken,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
