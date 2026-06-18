import { homedir, hostname } from "node:os";
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
  t3codeServerUrl: z.string().url().optional(),
  t3codeAuthToken: z.string().optional(),
  t3codeProjectId: z.string().optional(),
  t3codeModelInstanceId: z.string().optional(),
  t3codeModel: z.string().optional(),
  t3codeWorktreePath: z.string().optional(),
  t3codeRuntimeMode: z.enum([
    "approval-required",
    "auto-accept-edits",
    "full-access",
  ]).optional(),
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
    t3codeServerUrl: process.env.OODA_T3CODE_SERVER_URL ?? process.env.T3CODE_SERVER_URL,
    t3codeAuthToken: process.env.OODA_T3CODE_AUTH_TOKEN ?? process.env.T3CODE_AUTH_TOKEN,
    t3codeProjectId: process.env.OODA_T3CODE_PROJECT_ID ?? process.env.T3CODE_PROJECT_ID,
    t3codeModelInstanceId:
      process.env.OODA_T3CODE_MODEL_INSTANCE_ID ?? process.env.T3CODE_MODEL_INSTANCE_ID,
    t3codeModel: process.env.OODA_T3CODE_MODEL ?? process.env.T3CODE_MODEL,
    t3codeWorktreePath:
      process.env.OODA_T3CODE_WORKTREE_PATH ?? process.env.T3CODE_WORKTREE_PATH,
    t3codeRuntimeMode:
      process.env.OODA_T3CODE_RUNTIME_MODE ?? process.env.T3CODE_RUNTIME_MODE,
  });
}
