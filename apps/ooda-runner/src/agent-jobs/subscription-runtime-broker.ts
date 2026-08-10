import { join, relative, resolve, sep } from "node:path";

import type { AgentJobClassV1 } from "@gmacko/ooda/contracts/v1";

const PROVIDER_API_KEY: Record<string, string | undefined> = {
  codex: "OPENAI_API_KEY",
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  grok: "XAI_API_KEY",
};

export type PreparedAgentRuntime = {
  authMode: "subscription" | "api_key";
  environment: Record<string, string>;
  permissionMode: "prompt" | "skip";
  allowedTools: string[];
  useOuterProcessSandbox: boolean;
  credentialCopies: Array<{
    sourcePath: string;
    destinationPath: string;
  }>;
};

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function isolatedSubscriptionCredentials(input: {
  provider: string;
  source: Record<string, string | undefined>;
  sourceHome: string;
  sandboxHome: string;
}): PreparedAgentRuntime["credentialCopies"] {
  if (input.provider === "codex" || input.provider === "openai") {
    const sourceCodexHome =
      input.source.CODEX_HOME ?? join(input.sourceHome, ".codex");
    return [
      {
        sourcePath: join(sourceCodexHome, "auth.json"),
        destinationPath: join(input.sandboxHome, ".codex", "auth.json"),
      },
    ];
  }
  if (input.provider === "claude") {
    const sourceClaudeHome =
      input.source.CLAUDE_CONFIG_DIR ?? join(input.sourceHome, ".claude");
    return [
      {
        sourcePath: join(sourceClaudeHome, ".credentials.json"),
        destinationPath: join(
          input.sandboxHome,
          ".claude",
          ".credentials.json",
        ),
      },
    ];
  }
  if (input.provider === "grok") {
    const sourceGrokHome =
      input.source.GROK_HOME ?? join(input.sourceHome, ".grok");
    return [
      {
        sourcePath: join(sourceGrokHome, "auth.json"),
        destinationPath: join(input.sandboxHome, ".grok", "auth.json"),
      },
    ];
  }
  throw new Error(
    `No isolated subscription credential profile is configured for ${input.provider}`,
  );
}

function baseEnvironment(
  source: Record<string, string | undefined>,
  sandboxPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      PATH: source.PATH,
      LANG: source.LANG,
      LC_ALL: source.LC_ALL,
      TERM: source.TERM,
      TMPDIR: join(sandboxPath, ".tmp"),
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function allowedClaudeTools(capabilities: string[]): string[] {
  const tools = new Set<string>();
  if (capabilities.includes("web.read")) {
    tools.add("WebSearch");
    tools.add("WebFetch");
  }
  if (capabilities.includes("scratch.read")) {
    tools.add("Read");
    tools.add("Glob");
    tools.add("Grep");
  }
  if (capabilities.includes("scratch.write")) {
    tools.add("Write");
    tools.add("Edit");
  }
  // Bash is intentionally not automatically allowed for a subscription
  // process with access to provider account state. Scratch prototypes route
  // to Codex app-server, whose own workspace sandbox constrains commands.
  return [...tools].sort();
}

export class SubscriptionRuntimeBroker {
  prepare(input: {
    provider: string;
    jobClass: AgentJobClassV1;
    capabilities: string[];
    billingPolicy:
      | "subscription_only"
      | "subscription_preferred"
      | "metered_allowed";
    authMode: "subscription" | "api_key";
    sandboxPath: string;
    credentialHomePath?: string;
    source?: Record<string, string | undefined>;
  }): PreparedAgentRuntime {
    const source = input.source ?? process.env;
    const environment = baseEnvironment(source, input.sandboxPath);

    if (input.authMode === "api_key") {
      if (input.billingPolicy !== "metered_allowed") {
        throw new Error(
          "Metered provider credentials require billingPolicy=\"metered_allowed\"",
        );
      }
      const credential = PROVIDER_API_KEY[input.provider];
      if (!credential || !source[credential]) {
        throw new Error(`No metered API credential is configured for ${input.provider}`);
      }
      environment.HOME = join(input.sandboxPath, ".home");
      environment[credential] = source[credential]!;
      return {
        authMode: "api_key",
        environment,
        permissionMode: "skip",
        allowedTools: [],
        useOuterProcessSandbox: true,
        credentialCopies: [],
      };
    }

    if (!source.HOME) {
      throw new Error(
        `Subscription runtime ${input.provider} requires a trusted host HOME`,
      );
    }
    if (!input.credentialHomePath) {
      throw new Error("Subscription runtime requires an ephemeral credential home");
    }
    const credentialHome = resolve(input.credentialHomePath);
    if (isInside(resolve(input.sandboxPath), credentialHome)) {
      throw new Error("Subscription credential home must be outside the agent workspace");
    }
    environment.HOME = credentialHome;
    if (input.provider === "codex" || input.provider === "openai") {
      environment.CODEX_HOME = join(credentialHome, ".codex");
    }
    // Never pass metered provider keys—or unrelated runner secrets—to a
    // subscription invocation. The official CLI resolves its own account.
    for (const credential of Object.values(PROVIDER_API_KEY)) {
      if (credential) delete environment[credential];
    }

    return {
      authMode: "subscription",
      environment,
      permissionMode: input.provider === "codex" ? "skip" : "prompt",
      allowedTools:
        input.provider === "claude"
          ? allowedClaudeTools(input.capabilities)
          : [],
      useOuterProcessSandbox: true,
      credentialCopies: isolatedSubscriptionCredentials({
        provider: input.provider,
        source,
        sourceHome: source.HOME,
        sandboxHome: credentialHome,
      }),
    };
  }
}
