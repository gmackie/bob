// Frontend app configuration
// These values should be fetched from the backend /api/config endpoint at runtime

export interface AppConfig {
  appName: string;
  enableGithubAuth: boolean;
  jeffMode: boolean;
  allowedAgents: string[];
}

let cachedConfig: AppConfig | null = null;

export const getAppConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const mode = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.MODE : undefined;
    const apiUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_URL : undefined;
    const apiBase = mode === 'production' && apiUrl
      ? import.meta.env.VITE_API_URL
      : '';

    const response = await fetch(`${apiBase}/api/config`);
    if (!response.ok) {
      throw new Error('Failed to fetch app config');
    }

    cachedConfig = await response.json();
    return cachedConfig!;
  } catch (error) {
    console.error('Failed to load app config, using defaults:', error);
    // Return defaults if config fetch fails
    cachedConfig = {
      appName: 'Bob',
      enableGithubAuth: false,
      jeffMode: false,
      allowedAgents: []
    };
    return cachedConfig;
  }
};

// Clear cache if needed
export const clearAppConfigCache = () => {
  cachedConfig = null;
};
