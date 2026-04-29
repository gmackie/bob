import { z } from "zod";

export const AdapterCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(["stdio", "api"]),
  supportedModels: z.array(z.string()),
  requiresApiKey: z.boolean(),
  apiKeyEnvVar: z.string(),
});

export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export interface AdapterCommand {
  binary: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AdapterEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data: string;
  timestamp: string;
  exitCode?: number;
}

export interface AgentAdapter {
  id: string;
  name: string;
  transport: "stdio" | "api";

  isAvailable(): boolean;

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand;

  execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }>;

  /**
   * Register tool descriptors for this adapter's upcoming ACP session.
   *
   * Optional: CLI-spawn adapters (Codex, Claude) don't have a dispatcher
   * to receive registrations yet. When ACP support lands (V2), adapters
   * that speak it will consume the stashed list here to register with
   * the remote agent.
   *
   * See `tool-registry.ts` for the import-facing helpers.
   */
  registerTools?(tools: ToolDescriptorLike[]): void;
}

/**
 * Structural type used by the optional `AgentAdapter#registerTools` hook.
 * Avoids a circular import into `tool-registry.ts` — the concrete
 * `ToolDescriptor` type lives there and conforms to this shape.
 */
export interface ToolDescriptorLike {
  name: string;
  description: string;
}
