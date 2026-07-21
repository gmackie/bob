/**
 * Secrets handler functions — pure business logic extracted from the tRPC
 * secrets router.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { DatabaseLike } from "../services/secrets/sessionSecretService";
import { SessionSecretService } from "../services/secrets/sessionSecretService";
import { ForgeGraphSecretAdapter } from "../services/secrets/forgegraphSecretAdapter";

import type { HandlerContext } from "./context.js";

// SessionSecretService's DatabaseLike declares its relational-query methods
// as `(args: unknown) => ...` so tests can supply Promise-returning mocks
// without conforming to drizzle's full generic query-builder signature.
// That looser param makes it *not* structurally assignable from the real
// Db type (whose findFirst/findMany take a specific config type, and a
// narrower-parameter function isn't assignable where a wider one is
// declared) — hence the explicit `as unknown as DatabaseLike` here. ctx.db
// genuinely implements every method DatabaseLike describes; this is a
// real Db value crossing a deliberately looser DI-interface boundary, not
// an unknown-shaped value.

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function secretsGetSessionSecretManifest(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  return service.listSessionSecrets({
    ...input,
    userId: ctx.userId,
  });
}

export async function secretsGetSessionSecretForExecution(
  ctx: HandlerContext,
  input: { sessionId: string; handle: string },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  return service.getSecretForSessionExecution({
    ...input,
    userId: ctx.userId,
  });
}

export async function secretsCreateSessionSecret(
  ctx: HandlerContext,
  input: {
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
  },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  return service.createSessionSecret({
    ...input,
    userId: ctx.userId,
  });
}

export async function secretsListSessionSecrets(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  return service.listSessionSecrets({
    ...input,
    userId: ctx.userId,
  });
}

export async function secretsDeleteSessionSecret(
  ctx: HandlerContext,
  input: { secretId: string },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  return service.deleteSessionSecret({
    ...input,
    userId: ctx.userId,
  });
}

export async function secretsMarkSecretUsed(
  _ctx: HandlerContext,
  input: {
    secretId: string;
    sessionId: string;
    executor: string;
    templateId?: string;
    commandPreview?: string;
    exitCode?: number;
    durationMs?: number;
  },
) {
  const service = new SessionSecretService(_ctx.db as unknown as DatabaseLike);
  return service.markSecretUsed(input);
}

export async function secretsUpsertProjectDeployBinding(
  _ctx: HandlerContext,
  input: {
    projectId: string;
    environment: "dev" | "staging" | "prod" | "preview";
    label: string;
    forgegraphKey: string;
    externalRef: string;
    transport: "template" | "http" | "stdin" | "file";
    templateId?: string;
  },
) {
  const service = new SessionSecretService(_ctx.db as unknown as DatabaseLike);
  return service.upsertProjectDeployBinding(input);
}

export async function secretsPromoteSessionSecret(
  ctx: HandlerContext,
  input: {
    secretId: string;
    projectId: string;
    environment: "dev" | "staging" | "prod" | "preview";
    forgegraphKey: string;
  },
) {
  const service = new SessionSecretService(ctx.db as unknown as DatabaseLike);
  const adapter = new ForgeGraphSecretAdapter();
  return service.promoteSessionSecret({
    ...input,
    userId: ctx.userId,
    adapter,
  });
}
