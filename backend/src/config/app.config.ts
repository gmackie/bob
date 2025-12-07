// Application configuration
// These can be controlled via environment variables for different build modes

export const appConfig = {
  // Application name - can be overridden via APP_NAME env var
  name: process.env.APP_NAME || 'Bob',

  // GitHub auth - disabled by default, enabled only when explicitly requested
  enableGithubAuth: process.env.USE_GITHUB_AUTH === 'true',

  // Jeff mode - restricts to Kiro agent only
  // When enabled: renames app to "Jeff" and shows only Kiro
  jeffMode: process.env.JEFF_MODE === 'true',

  // Get the effective app name (respects Jeff mode)
  getAppName(): string {
    if (this.jeffMode) {
      return 'Jeff';
    }
    return this.name;
  },

  // Get allowed agent types based on mode
  getAllowedAgents(): string[] {
    if (this.jeffMode) {
      return ['kiro'];
    }
    // Return null to indicate all agents are allowed
    return [];
  },

  // Check if an agent type is allowed
  isAgentAllowed(agentType: string): boolean {
    const allowed = this.getAllowedAgents();
    if (allowed.length === 0) {
      return true; // All agents allowed
    }
    return allowed.includes(agentType);
  }
};
