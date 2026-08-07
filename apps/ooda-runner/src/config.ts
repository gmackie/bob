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
  bobDevDir: z.string().default(join(homedir(), "dev")),
  bobMaxConcurrent: z.coerce.number().default(2),
  agentJobScratchRoot: z.string().default(join(tmpdir(), "ooda-agent-jobs")),
  agentJobMaxConcurrent: z.coerce.number().int().min(1).max(3).default(3),
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
    bobDevDir: process.env.BOB_DEV_DIR,
    bobMaxConcurrent: process.env.BOB_MAX_CONCURRENT,
    agentJobScratchRoot: process.env.OODA_AGENT_JOB_SCRATCH_ROOT,
    agentJobMaxConcurrent: process.env.OODA_AGENT_JOB_MAX_CONCURRENT,
  });
}
