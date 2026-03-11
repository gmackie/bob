// OAuth state storage - in production, use Redis
// This is an in-memory store that will lose state on server restart
// but works for development and single-instance deployments

interface OAuthState {
  returnUrl: string;
  expiresAt: number;
}

class StateStore {
  private states = new Map<string, OAuthState>();

  set(state: string, data: OAuthState): void {
    this.states.set(state, data);
    this.cleanup();
  }

  get(state: string): OAuthState | undefined {
    return this.states.get(state);
  }

  delete(state: string): void {
    this.states.delete(state);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.states) {
      if (value.expiresAt < now) {
        this.states.delete(key);
      }
    }
  }
}

// Global singleton
const globalForState = globalThis as unknown as {
  oauthStateStore: StateStore | undefined;
};

export const stateStore = globalForState.oauthStateStore ?? new StateStore();

if (process.env.NODE_ENV !== "production") {
  globalForState.oauthStateStore = stateStore;
}
