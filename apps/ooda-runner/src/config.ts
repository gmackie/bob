import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

export const RunnerConfigSchema = z.object({
  storageRoot: z.string().default(join(homedir(), ".ooda", "threads")),
  serverUrl: z.string().url().default("http://localhost:3000"),
  runnerToken: z.string().optional(),
  runnerName: z.string().default(`runner-${hostname()}`),
  port: z.coerce.number().default(3001),
  bobGatewayUrl: z.string().optional(),
  /** Bob HTTP base URL for the public run API (e.g. https://bob.blder.bot). */
  bobApiUrl: z.string().optional(),
  bobApiKey: z.string().optional(),
  bobWorkspaceId: z.string().optional(),
  bobDeliveryEnabled: z
    .preprocess((value) => value === true || value === "true", z.boolean())
    .default(false),
  bobDevDir: z.string().default(join(homedir(), "dev")),
  bobMaxConcurrent: z.coerce.number().default(2),
  agentJobScratchRoot: z.string().default(join(tmpdir(), "ooda-agent-jobs")),
  agentJobMaxConcurrent: z.coerce.number().int().min(1).max(3).default(3),
  hostTurnEnabled: z
    .preprocess(
      (value) => value === undefined || value === true || value === "true",
      z.boolean(),
    )
    .default(true),
  hostTurnScratchRoot: z.string().default(join(tmpdir(), "ooda-host-turns")),
  hostTurnMaxConcurrent: z.coerce.number().int().min(1).max(3).default(1),
  grokHostModel: z.string().optional(),
  claudeHostModel: z.string().optional(),
  openaiHostModel: z.string().optional(),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export function loadConfig(): RunnerConfig {
  return RunnerConfigSchema.parse({
    storageRoot: process.env.OODA_STORAGE_ROOT,
    serverUrl: process.env.OODA_SERVER_URL,
    runnerToken: process.env.OODA_RUNNER_TOKEN,
    runnerName: process.env.OODA_RUNNER_NAME,
    port: process.env.OODA_RUNNER_PORT,
    bobGatewayUrl: process.env.BOB_GATEWAY_URL,
    bobApiUrl: process.env.BOB_API_URL,
    bobApiKey: process.env.BOB_API_KEY,
    bobWorkspaceId: process.env.BOB_WORKSPACE_ID,
    bobDeliveryEnabled: process.env.OODA_BOB_DELIVERY_ENABLED,
    bobDevDir: process.env.BOB_DEV_DIR,
    bobMaxConcurrent: process.env.BOB_MAX_CONCURRENT,
    agentJobScratchRoot: process.env.OODA_AGENT_JOB_SCRATCH_ROOT,
    agentJobMaxConcurrent: process.env.OODA_AGENT_JOB_MAX_CONCURRENT,
    hostTurnEnabled: process.env.OODA_HOST_TURN_ENABLED,
    hostTurnScratchRoot: process.env.OODA_HOST_TURN_SCRATCH_ROOT,
    hostTurnMaxConcurrent: process.env.OODA_HOST_TURN_MAX_CONCURRENT,
    grokHostModel: process.env.OODA_GROK_HOST_MODEL,
    claudeHostModel: process.env.OODA_CLAUDE_HOST_MODEL,
    openaiHostModel: process.env.OODA_OPENAI_HOST_MODEL,
  });
}
