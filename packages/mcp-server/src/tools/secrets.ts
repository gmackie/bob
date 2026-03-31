import type { ToolContext, ToolDefinition } from "./types.js";
import { createToolResult, errorResult, jsonResult } from "./types.js";

interface SessionSecretManifestEntry {
  handle: string;
  label: string;
  allowedTemplates?: string[];
  status?: string;
  provider?: string;
}

function readManifest(): SessionSecretManifestEntry[] {
  const raw = process.env.BOB_SESSION_SECRET_MANIFEST;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SessionSecretManifestEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const listSessionSecretsTool: ToolDefinition = {
  tool: {
    name: "list_session_secrets",
    description:
      "List the available session secret handles and their allowed templates without revealing plaintext values.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    return jsonResult({
      count: readManifest().length,
      secrets: readManifest(),
    });
  },
};

export const execSessionSecretTool: ToolDefinition = {
  tool: {
    name: "exec_session_secret",
    description:
      "Execute an approved session-secret template without exposing the secret value. Use this instead of printing or exporting the secret.",
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Secret handle from list_session_secrets or the user prompt.",
        },
        template: {
          type: "string",
          description: "Approved template id, such as gh-api or docker-login.",
        },
        args: {
          type: "object",
          description: "Template arguments. Values are validated by Bob before execution.",
          additionalProperties: {
            type: "string",
          },
        },
      },
      required: ["handle", "template"],
    },
  },
  handler: async (args, _ctx: ToolContext) => {
    const brokerUrl = process.env.BOB_SECRET_BROKER_URL;
    const brokerToken = process.env.BOB_SECRET_BROKER_TOKEN;

    if (!brokerUrl || !brokerToken) {
      return errorResult("Session secret broker is not configured");
    }

    const { handle, template, args: templateArgs } = args as {
      handle: string;
      template: string;
      args?: Record<string, string>;
    };

    try {
      const response = await fetch(brokerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: brokerToken,
          handle,
          templateId: template,
          args: templateArgs ?? {},
        }),
      });

      const result = (await response.json()) as {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        error?: string;
      };

      if (!response.ok) {
        return errorResult(result.error ?? `Broker request failed (${response.status})`);
      }

      return createToolResult(
        [
          `exit_code=${result.exitCode ?? 0}`,
          result.stdout ? `stdout:\n${result.stdout}` : null,
          result.stderr ? `stderr:\n${result.stderr}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const secretTools: ToolDefinition[] = [
  listSessionSecretsTool,
  execSessionSecretTool,
];
