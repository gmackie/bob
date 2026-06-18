/**
 * Effect-RPC handler functions for the secrets RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  secretsGetSessionSecretManifest,
  secretsGetSessionSecretForExecution,
  secretsCreateSessionSecret,
  secretsListSessionSecrets,
  secretsDeleteSessionSecret,
  secretsMarkSecretUsed,
  secretsUpsertProjectDeployBinding,
  secretsPromoteSessionSecret,
} from "../handlers/secrets.js";

export const makeSecretsRpcHandlers = (ctx: HandlerContext) => ({
  "secrets.getSessionSecretManifest": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(secretsGetSessionSecretManifest, ctx, payload, "secrets"),

  "secrets.getSessionSecretForExecution": ({
    payload,
  }: {
    payload: { sessionId: string; handle: string };
  }) => wrapHandler(secretsGetSessionSecretForExecution, ctx, payload, "secrets"),

  "secrets.createSessionSecret": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      label: string;
      handle: string;
      value: string;
      transport: "template" | "http" | "stdin" | "file";
      policy: {
        allowedTemplates: string[];
        redactOutput: boolean;
        maxUses?: number | null;
        templatePolicies?: Record<
          string,
          { allowedArgPrefixes?: Record<string, string[]> }
        >;
      };
    };
  }) => wrapHandler(secretsCreateSessionSecret, ctx, payload, "secrets"),

  "secrets.listSessionSecrets": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(secretsListSessionSecrets, ctx, payload, "secrets"),

  "secrets.deleteSessionSecret": ({
    payload,
  }: {
    payload: { secretId: string };
  }) => wrapHandler(secretsDeleteSessionSecret, ctx, payload, "secrets"),

  "secrets.markSecretUsed": ({
    payload,
  }: {
    payload: {
      secretId: string;
      sessionId: string;
      executor: string;
      templateId?: string;
      commandPreview?: string;
      exitCode?: number;
      durationMs?: number;
    };
  }) => wrapHandler(secretsMarkSecretUsed, ctx, payload, "secrets"),

  "secrets.upsertProjectDeployBinding": ({
    payload,
  }: {
    payload: {
      projectId: string;
      environment: "dev" | "staging" | "prod" | "preview";
      label: string;
      forgegraphKey: string;
      externalRef: string;
      transport: "template" | "http" | "stdin" | "file";
      templateId?: string;
    };
  }) => wrapHandler(secretsUpsertProjectDeployBinding, ctx, payload, "secrets"),

  "secrets.promoteSessionSecret": ({
    payload,
  }: {
    payload: {
      secretId: string;
      projectId: string;
      environment: "dev" | "staging" | "prod" | "preview";
      forgegraphKey: string;
    };
  }) => wrapHandler(secretsPromoteSessionSecret, ctx, payload, "secrets"),
});
