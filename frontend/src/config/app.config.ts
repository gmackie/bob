// Frontend app configuration
// These values should be fetched from the backend /api/config endpoint at runtime

interface AppConfig {
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
    const apiBase = import.meta.env.MODE === 'production' && import.meta.env.VITE_API_URL
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
    return {
      appName: 'Bob',
      enableGithubAuth: true,
      jeffMode: false,
      allowedAgents: []
    };
  }
};

// Clear cache if needed
export const clearAppConfigCache = () => {
  cachedConfig = null;
};
