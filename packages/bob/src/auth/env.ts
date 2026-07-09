import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export function authEnv() {
  return createEnv({
    server: {
      AUTH_GITHUB_ID: z.string().min(1),
      AUTH_GITHUB_SECRET: z.string().min(1),
      AUTH_GITLAB_ID: z.string().min(1).optional(),
      AUTH_GITLAB_SECRET: z.string().min(1).optional(),
      AUTH_SECRET:
        process.env.NODE_ENV === "production"
          ? z.string().min(1)
          : z.string().min(1).optional(),
      NODE_ENV: z.enum(["development", "production"]).optional(),
      // Required in production — vaults fail closed without a ≥32-char key.
      // Optional in development so unit tests and local smoke runs can opt in.
      GIT_TOKEN_ENCRYPTION_KEY:
        process.env.NODE_ENV === "production"
          ? z.string().min(32)
          : z.string().min(32).optional(),
      // Optional previous key for dual-key decrypt during rotation window.
      GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().min(32).optional(),
    },
    runtimeEnv: process.env,
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === "lint",
  });
}
