export interface ExecutionTemplate {
  kind: "env-fixed" | "stdin" | "http" | "file";
  command?: string[];
  env?: Record<string, string>;
  stdin?: string;
  validateArgs?: (args: Record<string, string>) => void;
}

export const EXECUTION_TEMPLATES: Record<string, ExecutionTemplate> = {
  "gh-api": {
    kind: "env-fixed",
    command: ["gh", "api", "{{arg:path}}"],
    env: {
      GITHUB_TOKEN: "{{secret}}",
    },
    validateArgs: (args) => {
      const path = args.path ?? "";
      if (!path.startsWith("/") || /\s/.test(path) || path.includes("://")) {
        throw new Error('Template "gh-api" requires a relative GitHub API path');
      }
    },
  },
  "docker-login": {
    kind: "stdin",
    command: [
      "docker",
      "login",
      "--username",
      "{{arg:username}}",
      "--password-stdin",
      "{{arg:registry}}",
    ],
    stdin: "{{secret}}",
    validateArgs: (args) => {
      const registry = args.registry ?? "";
      const username = args.username ?? "";
      if (!/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(registry)) {
        throw new Error('Template "docker-login" requires a registry host');
      }
      if (!/^[^\s:]+$/.test(username)) {
        throw new Error('Template "docker-login" requires a simple username');
      }
    },
  },
};

const UNSAFE_EXECUTABLES = new Set(["sh", "bash", "zsh", "fish"]);

export function assertSafeTemplate(
  templateId: string,
  template: ExecutionTemplate,
): void {
  const command = template.command ?? [];
  const executable = command[0];
  if (!executable) return;

  if (UNSAFE_EXECUTABLES.has(executable)) {
    throw new Error(`Unsafe execution template "${templateId}"`);
  }

  if (executable === "node" && command.includes("-e")) {
    throw new Error(`Unsafe execution template "${templateId}"`);
  }
}
