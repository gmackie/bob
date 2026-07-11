import type { ProviderCapabilities, ProviderHealthSnapshot, ProviderId } from "./contract.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

const providerCommands: Record<ProviderId, string> = {
  claude: "claude",
  codex: "codex",
  grok: "grok",
  "cursor-agent": "cursor-agent",
};

const authArgs: Record<ProviderId, string[]> = {
  claude: ["auth", "status"],
  codex: ["login", "status"],
  grok: ["models"],
  "cursor-agent": ["status"],
};

const capabilities: Record<ProviderId, ProviderCapabilities> = {
  claude: {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: true, modelIdentity: true,
  },
  codex: {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
  grok: {
    approval: true, followUp: true, resume: false, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
  "cursor-agent": {
    approval: true, followUp: true, resume: true, cancel: true, structuredUsage: true,
    providerAllowance: false, providerResetAt: false, directCost: false, modelIdentity: true,
  },
};

export async function probeCliProvider(
  provider: ProviderId,
  run: RunCommand,
  now = new Date(),
): Promise<ProviderHealthSnapshot> {
  const command = providerCommands[provider];
  const base = { provider, command, capabilities: capabilities[provider], checkedAt: now.toISOString() };

  try {
    const version = await run(command, ["--version"]);
    if (version.code !== 0) {
      return { ...base, installed: false, authenticated: false, status: "unavailable", error: "version probe failed" };
    }
    const auth = await run(command, authArgs[provider]);
    if (auth.code !== 0) {
      return {
        ...base,
        installed: true,
        authenticated: false,
        version: version.stdout.trim() || undefined,
        status: "unauthenticated",
        error: "authentication probe failed",
      };
    }
    return {
      ...base,
      installed: true,
      authenticated: true,
      version: version.stdout.trim() || undefined,
      status: "ready",
    };
  } catch (error) {
    return {
      ...base,
      installed: false,
      authenticated: false,
      status: "unavailable",
      error: error instanceof Error && error.message.includes("ENOENT") ? "command not found" : "probe failed",
    };
  }
}
