import type { DatabaseLike } from "../../services/secrets/sessionSecretService";
import { describe, expect, it, vi } from "vitest";
import { secretsUpsertProjectDeployBinding, secretsMarkSecretUsed } from "../secrets";
import type { HandlerContext } from "../context";

const input = {
  projectId: "project-foreign", environment: "dev" as const, label: "deploy",
  forgegraphKey: "deploy", externalRef: "ref", transport: "template" as const,
};

describe("deployment secret authorization", () => {
  it("denies a project outside the caller's workspaces before writing a binding", async () => {
    const db = {
      query: {
        projects: { findFirst: vi.fn().mockResolvedValue({ id: input.projectId, workspaceId: "foreign" }) },
        workspaces: { findFirst: vi.fn().mockResolvedValue({ id: "foreign", ownerUserId: "other" }) },
        workspaceMembers: { findFirst: vi.fn().mockResolvedValue(undefined) },
      },
      insert: vi.fn(() => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }) }) })),
    };
    await expect(secretsUpsertProjectDeployBinding({ db, userId: "caller" } as unknown as HandlerContext, input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("secret usage authorization", () => {
  it("rejects a secret attached to another session even when both sessions have the same owner", async () => {
    const db = {
      query: {
        chatConversations: { findFirst: vi.fn().mockResolvedValue({ id: "session", userId: "caller" }) },
        sessionSecrets: { findFirst: vi.fn().mockResolvedValue({ id: "secret", sessionId: "other-session", userId: "caller" }) },
      },
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
    };
    await expect(secretsMarkSecretUsed({ db, userId: "caller" } as unknown as HandlerContext,
      { secretId: "secret", sessionId: "session", executor: "broker" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

it("deduplicates an authorized usage retry using its stable usage ID", async () => {
  const stored: Record<string, unknown>[] = [];
  const db = {
    query: {
      chatConversations: { findFirst: vi.fn().mockResolvedValue({ id: "session", userId: "caller" }) },
      sessionSecrets: { findFirst: vi.fn().mockResolvedValue({ id: "secret", sessionId: "session", userId: "caller" }) },
      sessionSecretUsages: { findMany: () => Promise.resolve(stored) },
    },
    insert: () => ({ values: (row: Record<string, unknown>) => ({
      returning: () => { stored.push(row); return Promise.resolve([row]); },
      onConflictDoNothing: () => ({ returning: () => {
        if (stored.some((old) => old.id === row.id)) return Promise.resolve([]);
        stored.push(row); return Promise.resolve([row]);
      } }),
    }) }),
  };
  const ctx = { db, userId: "caller" } as unknown as HandlerContext;
  const usage = { secretId: "secret", sessionId: "session", executor: "broker", usageId: "00000000-0000-4000-8000-000000000001" };
  const first = await secretsMarkSecretUsed(ctx, usage);
  expect(await secretsMarkSecretUsed(ctx, usage)).toEqual(first);
  expect(stored).toHaveLength(1);
  await expect(secretsMarkSecretUsed(ctx, { ...usage, executor: "other" })).rejects.toMatchObject({ code: "CONFLICT" });
});

it.each(["owner", "member"])("allows an authorized %s to bind a project", async (access) => {
  const db = {
    query: {
      projects: { findFirst: () => Promise.resolve({ id: input.projectId, workspaceId: "workspace" }) },
      workspaces: { findFirst: () => Promise.resolve({ ownerUserId: access === "owner" ? "caller" : "other" }) },
      workspaceMembers: { findFirst: () => Promise.resolve(access === "member" ? { id: "member" } : undefined) },
    },
    insert: vi.fn(() => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([input]) }) }) })),
  };
  expect(await secretsUpsertProjectDeployBinding({ db, userId: "caller" } as unknown as HandlerContext, input)).toEqual(input);
  expect(db.insert).toHaveBeenCalledOnce();
});

it("rejects promotion before reading plaintext or calling an external provider", async () => {
  const { SessionSecretService } = await import("../../services/secrets/sessionSecretService");
  const findSecret = vi.fn();
  const promote = vi.fn();
  const db = {
    query: {
      projects: { findFirst: () => Promise.resolve({ id: input.projectId, workspaceId: "foreign" }) },
      workspaces: { findFirst: () => Promise.resolve({ ownerUserId: "other" }) },
      workspaceMembers: { findFirst: () => Promise.resolve(undefined) },
      sessionSecrets: { findFirst: findSecret },
    },
  };
  const service = new SessionSecretService(db as unknown as DatabaseLike);
  await expect(service.promoteSessionSecret({ userId: "caller", secretId: "secret", projectId: input.projectId,
    environment: "dev", forgegraphKey: "key", adapter: { upsertDeploySecret: promote } as never })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(findSecret).not.toHaveBeenCalled();
  expect(promote).not.toHaveBeenCalled();
});

it("encodes denied project binding and usage failures in their Effect wire contracts", async () => {
  const { Effect, Schema } = await import("effect");
  const { SecretsSessionUpsertDeployBindingRpc, SecretsSessionMarkUsedRpc } = await import("@gmacko/core/contracts/groups/secrets");
  const { makeSecretsRpcHandlers } = await import("../../rpc-handlers/secrets");
  const ctx = { db: { query: {} }, userId: "caller" } as unknown as HandlerContext;
  const handlers = makeSecretsRpcHandlers(ctx);
  const projectError = await Effect.runPromise(handlers["secrets.upsertProjectDeployBinding"]({ payload: input }).pipe(Effect.flip));
  expect(Schema.encodeSync(SecretsSessionUpsertDeployBindingRpc.errorSchema)(projectError)).toMatchObject({ _tag: "NotFoundError" });
  const usageError = await Effect.runPromise(handlers["secrets.markSecretUsed"]({ payload: { secretId: "secret", sessionId: "missing", executor: "broker" } }).pipe(Effect.flip));
  expect(Schema.encodeSync(SecretsSessionMarkUsedRpc.errorSchema)(usageError)).toMatchObject({ _tag: "NotFoundError" });
});
