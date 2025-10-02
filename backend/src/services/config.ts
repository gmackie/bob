import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentType } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AgentConfig {
  enabled: boolean;
  default: boolean;
  priority: number;
  settings: {
    autoStart: boolean;
    restartOnCrash: boolean;
    maxRestarts: number;
    sandbox?: boolean;
    autoApproval?: boolean;
  };
}

export interface ConfigPreferences {
  defaultAgent: AgentType;
  fallbackOrder: AgentType[];
  autoSelectAvailable: boolean;
  showUnavailableAgents: boolean;
  persistAgentSelection: boolean;
}

export interface UIConfig {
  showAgentBadges: boolean;
  compactBadges: boolean;
  showAgentTooltips: boolean;
  showAgentStatus: boolean;
  groupByAvailability: boolean;
}

export interface AppConfig {
  agents: Record<AgentType, AgentConfig>;
  preferences: ConfigPreferences;
  ui: UIConfig;
}

export class ConfigService {
  private configPath: string;
  private config: AppConfig;
  private userConfigPath?: string;

  constructor(configPath?: string) {
    this.configPath = configPath || join(__dirname, '../../config/agents.json');
    this.userConfigPath = join(process.env.HOME || '~', '.bob', 'config.json');
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    try {
      // Load default config
      const defaultConfig = JSON.parse(
        readFileSync(this.configPath, 'utf-8')
      ) as AppConfig;

      // Merge with user config if exists
      if (this.userConfigPath && existsSync(this.userConfigPath)) {
        const userConfig = JSON.parse(
          readFileSync(this.userConfigPath, 'utf-8')
        );
        return this.mergeConfigs(defaultConfig, userConfig);
      }

      return defaultConfig;
    } catch (error) {
      console.error('Error loading config:', error);
      // Return sensible defaults if config fails to load
      return this.getDefaultConfig();
    }
  }

  private mergeConfigs(defaultConfig: AppConfig, userConfig: Partial<AppConfig>): AppConfig {
    return {
      agents: { ...defaultConfig.agents, ...userConfig.agents },
      preferences: { ...defaultConfig.preferences, ...userConfig.preferences },
      ui: { ...defaultConfig.ui, ...userConfig.ui }
    };
  }

  private getDefaultConfig(): AppConfig {
    return {
      agents: {
        'claude': {
          enabled: true,
          default: true,
          priority: 1,
          settings: {
            autoStart: true,
            restartOnCrash: true,
            maxRestarts: 3
          }
        }
      } as Record<AgentType, AgentConfig>,
      preferences: {
        defaultAgent: 'claude',
        fallbackOrder: ['claude'],
        autoSelectAvailable: true,
        showUnavailableAgents: true,
        persistAgentSelection: true
      },
      ui: {
        showAgentBadges: true,
        compactBadges: true,
        showAgentTooltips: true,
        showAgentStatus: true,
        groupByAvailability: false
      }
    };
  }

  getAgentConfig(agentType: AgentType): AgentConfig | undefined {
    return this.config.agents[agentType];
  }

  isAgentEnabled(agentType: AgentType): boolean {
    const config = this.getAgentConfig(agentType);
    return config?.enabled ?? false;
  }

  getDefaultAgent(): AgentType {
    return this.config.preferences.defaultAgent;
  }

  getFallbackOrder(): AgentType[] {
    return this.config.preferences.fallbackOrder;
  }

  getPreferences(): ConfigPreferences {
    return this.config.preferences;
  }

  getUIConfig(): UIConfig {
    return this.config.ui;
  }

  saveUserPreference(key: keyof ConfigPreferences, value: any): void {
    if (!this.userConfigPath) return;

    try {
      let userConfig: Partial<AppConfig> = {};

      if (existsSync(this.userConfigPath)) {
        userConfig = JSON.parse(readFileSync(this.userConfigPath, 'utf-8'));
      }

      if (!userConfig.preferences) {
        userConfig.preferences = {} as ConfigPreferences;
      }

      (userConfig.preferences as any)[key] = value;

      writeFileSync(this.userConfigPath, JSON.stringify(userConfig, null, 2));

      // Reload config to apply changes
      this.config = this.loadConfig();
    } catch (error) {
      console.error('Error saving user preference:', error);
    }
  }

  validateConfig(): string[] {
    const errors: string[] = [];

    // Validate that at least one agent is enabled
    const enabledAgents = Object.entries(this.config.agents)
      .filter(([_, config]) => config.enabled);

    if (enabledAgents.length === 0) {
      errors.push('At least one agent must be enabled');
    }

    // Validate default agent exists and is enabled
    const defaultConfig = this.getAgentConfig(this.config.preferences.defaultAgent);
    if (!defaultConfig || !defaultConfig.enabled) {
      errors.push('Default agent must exist and be enabled');
    }

    // Validate fallback order contains valid agents
    for (const agentType of this.config.preferences.fallbackOrder) {
      if (!this.config.agents[agentType]) {
        errors.push(`Invalid agent in fallback order: ${agentType}`);
      }
    }

    return errors;
  }
}