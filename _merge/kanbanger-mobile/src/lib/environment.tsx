import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

export type Environment = "beta" | "prod";

interface EnvironmentConfig {
  apiUrl: string;
  authRequired: boolean;
  label: string;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  beta: {
    apiUrl: "https://beta.tasks.gmac.io",
    authRequired: false,
    label: "Beta (No Auth)",
  },
  prod: {
    apiUrl: "https://tasks.gmac.io",
    authRequired: true,
    label: "Production (Entra ID)",
  },
};

interface EnvironmentContextValue {
  environment: Environment;
  config: EnvironmentConfig;
  setEnvironment: (env: Environment) => Promise<void>;
  isLoading: boolean;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

const APP_VARIANT = Constants.expoConfig?.extra?.appVariant as string | undefined;
const IS_DEV_BUILD = __DEV__ || APP_VARIANT === "development";
const STORAGE_KEY = IS_DEV_BUILD ? "app_environment_dev" : "app_environment";
const DEFAULT_ENV: Environment = IS_DEV_BUILD ? "beta" : "prod";

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironmentState] = useState<Environment>(DEFAULT_ENV);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === "beta" || saved === "prod") {
        setEnvironmentState(saved);
      }
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });
  }, []);

  const setEnvironment = useCallback(async (env: Environment) => {
    setEnvironmentState(env);
    await AsyncStorage.setItem(STORAGE_KEY, env);
    await SecureStore.deleteItemAsync("beta_user_id");
    await SecureStore.deleteItemAsync("session_token");
  }, []);

  const config = ENVIRONMENTS[environment];

  return (
    <EnvironmentContext.Provider value={{ environment, config, setEnvironment, isLoading }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error("useEnvironment must be used within EnvironmentProvider");
  }
  return context;
}
