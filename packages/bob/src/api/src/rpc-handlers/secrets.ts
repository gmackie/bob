/**
 * Effect-RPC handler functions for the secrets RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapAuthorizedHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapAuthorizedHandler } from "../handlers/authorized-rpc.js";
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
  }) => wrapAuthorizedHandler(secretsGetSessionSecretManifest, ctx, payload, "secrets"),

  "secrets.getSessionSecretForExecution": ({
    payload,
  }: {
    payload: { sessionId: string; handle: string };
  }) => wrapAuthorizedHandler(secretsGetSessionSecretForExecution, ctx, payload, "secrets"),

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
  }) => wrapAuthorizedHandler(secretsCreateSessionSecret, ctx, payload, "secrets"),

  "secrets.listSessionSecrets": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(secretsListSessionSecrets, ctx, payload, "secrets"),

  "secrets.deleteSessionSecret": ({
    payload,
  }: {
    payload: { secretId: string };
  }) => wrapAuthorizedHandler(secretsDeleteSessionSecret, ctx, payload, "secrets"),

  "secrets.markSecretUsed": ({
    payload,
  }: {
    payload: {
      usageId?: string;
      secretId: string;
      sessionId: string;
      executor: string;
      templateId?: string;
      commandPreview?: string;
      exitCode?: number;
      durationMs?: number;
    };
  }) => wrapAuthorizedHandler(secretsMarkSecretUsed, ctx, payload, "secrets"),

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
  }) => wrapAuthorizedHandler(secretsUpsertProjectDeployBinding, ctx, payload, "secrets"),

  "secrets.promoteSessionSecret": ({
    payload,
  }: {
    payload: {
      secretId: string;
      projectId: string;
      environment: "dev" | "staging" | "prod" | "preview";
      forgegraphKey: string;
    };
  }) => wrapAuthorizedHandler(secretsPromoteSessionSecret, ctx, payload, "secrets"),
});
