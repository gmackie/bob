import { spawn } from "node:child_process";

import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { sessionSecrets, sessionSecretUsages } from "@bob/db/schema";

import { SessionSecretBroker } from "./sessionSecretBroker.js";
import { prepareSessionSecretTooling } from "./sessionSecretTooling.js";

interface RunCommandSpec {
  command: string[];
  env?: Record<string, string>;
  stdin?: string;
}

interface GatewayBrokerRequest {
  token: string;
  handle: string;
  templateId: string;
  args: Record<string, string>;
}

const bobApiUrl = process.env.BOB_API_URL ?? "http://localhost:3000";
const bobApiKey = process.env.BOB_API_KEY;
const signingKey =
  process.env.SESSION_SECRET_BROKER_SIGNING_KEY ??
  process.env.BOB_API_KEY ??
  "bob-session-secret-broker-dev-key";

async function fetchSecretForExecution(sessionId: string, handle: string) {
  if (!bobApiKey) {
    throw new Error("BOB_API_KEY not configured on gateway");
  }

  const url = new URL("/api/trpc/secrets.getSessionSecretForExecution", bobApiUrl);
  url.searchParams.set(
    "input",
    JSON.stringify({
      sessionId,
      handle,
    }),
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${bobApiKey}`,
    },
  });

  const payload = (await response.json()) as {
    result?: {
      data?: {
        json?: unknown;
      } & Record<string, unknown>;
    };
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Secret lookup failed with ${response.status}`,
    );
  }

  const result = payload.result?.data;
  return ((result?.json as Record<string, unknown> | undefined) ??
    (result as Record<string, unknown> | undefined) ??
    null) as {
    id: string;
    handle: string;
    value: string;
    policy?: {
      allowedTemplates?: string[];
      redactOutput?: boolean;
    };
  } | null;
}

async function fetchSessionSecretManifest(sessionId: string) {
  if (!bobApiKey) {
    return [];
  }

  const url = new URL("/api/trpc/secrets.getSessionSecretManifest", bobApiUrl);
  url.searchParams.set(
    "input",
    JSON.stringify({
      sessionId,
    }),
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${bobApiKey}`,
    },
  });

  const payload = (await response.json()) as {
    result?: {
      data?: {
        json?: unknown;
      } & Record<string, unknown>;
    };
  };

  if (!response.ok) {
    return [];
  }

  const result = payload.result?.data;
  return ((result?.json as unknown[] | undefined) ??
    (result as unknown[] | undefined) ??
    []) as Array<Record<string, unknown>>;
}

async function runCommand(spec: RunCommandSpec) {
  const executable = spec.command[0];
  if (!executable) {
    throw new Error("Execution template resolved to an empty command");
  }

  const startedAt = Date.now();

  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }>((resolve, reject) => {
    const child = spawn(executable, spec.command.slice(1), {
      env: {
        ...process.env,
        ...spec.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
      });
    });

    if (spec.stdin) {
      child.stdin?.end(spec.stdin);
      return;
    }

    child.stdin?.end();
  });
}

const sessionSecretBroker = new SessionSecretBroker({
  secretLookup: fetchSecretForExecution,
  runner: runCommand,
  recordUsage: async (input) => {
    await db.insert(sessionSecretUsages).values({
      id: crypto.randomUUID(),
      secretId: input.secretId,
      sessionId: input.sessionId,
      executor: "broker",
      templateId: input.templateId,
      commandPreview: input.commandPreview,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
    });

    await db
      .update(sessionSecrets)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessionSecrets.id, input.secretId));
  },
  signingKey,
});

export async function buildSessionSecretLaunchEnv(input: {
  sessionId: string;
  gatewayPort: number;
  baseEnv?: Record<string, string>;
}) {
  const manifest = await fetchSessionSecretManifest(input.sessionId);

  return await prepareSessionSecretTooling({
    sessionId: input.sessionId,
    gatewayUrl: `http://127.0.0.1:${input.gatewayPort}/session/secrets/execute`,
    brokerToken: sessionSecretBroker.issueToken({ sessionId: input.sessionId }),
    manifest,
    baseEnv: input.baseEnv,
  });
}

export async function executeSessionSecretBrokerRequest(
  input: GatewayBrokerRequest,
) {
  return await sessionSecretBroker.executeTemplate(input);
}
