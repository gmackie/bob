import {
  MarkTransitionsSeenRpc,
  ReorderQueueRpc,
  SetNotificationPreferenceRpc,
} from "@gmacko/bob/contracts";
import { AuthMiddleware } from "@gmacko/core/auth";
import { GmackoDb } from "@gmacko/core/db";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { TRPCError } from "@trpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PreferenceHandlers from "../handlers/notificationPreferences.js";
import type * as ProjectHandlers from "../handlers/project.js";
import type * as PrHandlers from "../handlers/pullRequest.js";
import type * as SettingsHandlers from "../handlers/settings.js";
import type * as WorkHandlers from "../handlers/workItems.js";
import type { RpcServerLayers } from "../rpc-server.js";
import { createBobQueryClient } from "../../../../../bob-client/src/query.js";
import { makeRpcHandler } from "../rpc-server.js";

vi.mock("@bob/db/client", () => ({ db: {} }));
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  preferences: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  reorder: vi.fn(),
  prs: vi.fn(),
  merge: vi.fn(),
}));
vi.mock("../handlers/project.js", async (original) => ({
  ...(await original<typeof ProjectHandlers>()),
  projectList: mocks.list,
  projectGet: mocks.get,
}));
vi.mock("../handlers/settings.js", async (original) => ({
  ...(await original<typeof SettingsHandlers>()),
  settingsGetPreferences: mocks.preferences,
  settingsUpdatePreferences: mocks.update,
}));
vi.mock("../handlers/notificationPreferences.js", async (original) => ({
  ...(await original<typeof PreferenceHandlers>()),
  notificationPreferencesSet: mocks.set,
}));
vi.mock("../handlers/workItems.js", async (original) => ({
  ...(await original<typeof WorkHandlers>()),
  workItemsReorderQueue: mocks.reorder,
}));
vi.mock("../handlers/pullRequest.js", async (original) => ({
  ...(await original<typeof PrHandlers>()),
  pullRequestList: mocks.prs,
  pullRequestMerge: mocks.merge,
}));
const findOutbox = vi.fn();
const findApiKeys = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const mockDb = {
  query: {
    apiKeys: { findMany: findApiKeys },
    notificationOutbox: { findMany: findOutbox },
  },
  update: vi.fn(() => ({ set: updateSet })),
};
const handler = makeRpcHandler({
  runtimeLayer: Layer.succeed(
    GmackoDb,
    mockDb as never,
  ) as unknown as RpcServerLayers["runtimeLayer"],
  authMiddlewareLayer: Layer.succeed(AuthMiddleware, (effect) =>
    Effect.provideService(effect, CurrentUser, { userId: "user-1" } as never),
  ) as unknown as RpcServerLayers["authMiddlewareLayer"],
});
const rpc = createBobQueryClient({
  baseURL: "http://bob.test/api/rpc",
  fetch: (input, init) => handler(new Request(input, init)),
});
const project = {
  id: "project-1",
  workspaceId: "workspace-1",
  name: "Bob",
  key: "BOB",
  leadUserId: null,
  forgeGraphAppId: null,
  repoUrl: null,
  defaultBranch: null,
  description: null,
  color: null,
  status: "active",
  automationSettings: { autoDispatch: true },
  planningProvider: "internal",
  defaultAgentType: "codex",
  linearProjectId: null,
  externalProvider: null,
  externalId: null,
  sourceMetadata: {},
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: null,
};
const counts = { issues: 1, tasks: 2, epics: 0, active: 1 };

describe("native Bob contracts through the production Effect HTTP assembly", () => {
  beforeEach(() => vi.clearAllMocks());
  it("preserves the Bob project list envelope and returns a missing project as null", async () => {
    const list = [
      {
        project,
        counts,
        linkedRepository: null,
        _latestActivity: project.createdAt,
      },
    ];
    mocks.list.mockResolvedValue(list);
    mocks.get.mockResolvedValue(null);
    expect(
      await rpc("project.list").call({ workspaceId: "workspace-1" }),
    ).toEqual(list);
    expect(await rpc("project.get").call({ id: "missing" })).toBeNull();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      { workspaceId: "workspace-1" },
    );
  });
  it("preserves nullable repository fields and capability evidence in detail", async () => {
    const detail = {
      project,
      counts,
      capabilities: { template: null },
      linkedRepository: {
        id: "repo",
        name: "bob",
        path: null,
        branch: null,
        mainBranch: null,
        remoteProvider: null,
        remoteOwner: null,
        remoteName: null,
        remoteUrl: null,
        buildSystem: null,
        dirty: null,
        stale: null,
        discoveryStatus: null,
      },
    };
    mocks.get.mockResolvedValue(detail);
    expect(await rpc("project.get").call({ id: project.id })).toEqual(detail);
  });
  it("encodes denied project access as a declared error", async () => {
    mocks.list.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Denied" }),
    );
    await expect(
      rpc("project.list").call({ workspaceId: "other" }),
    ).rejects.toMatchObject({ _tag: "BobForbiddenError" });
  });
  it("round trips language and quiet hours preferences including nullable updatedAt", async () => {
    const prefs = {
      userId: "user-1",
      theme: "system",
      language: "fr",
      timezone: "UTC",
      pushNotifications: true,
      emailNotifications: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      updatedAt: null,
    };
    mocks.preferences.mockResolvedValue(prefs);
    mocks.update.mockResolvedValue(prefs);
    expect(await rpc("settings.getPreferences").call(undefined)).toEqual(prefs);
    await rpc("settings.updatePreferences").call({
      language: "fr",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      { language: "fr", quietHoursStart: "22:00", quietHoursEnd: "07:00" },
    );
  });
  it("delivers queue order and per-channel preferences to the authorized handlers", async () => {
    mocks.set.mockResolvedValue({ ok: true });
    mocks.reorder.mockResolvedValue({ success: true });
    const pref = {
      type: "task_completed",
      channel: "push",
      enabled: false,
    } as const;
    expect(await rpc("settings.setNotificationPreference").call(pref)).toEqual({
      ok: true,
    });
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      pref,
    );
    const order = {
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workItemIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    };
    expect(await rpc("workItem.reorderQueue").call(order)).toEqual({
      success: true,
    });
    expect(mocks.reorder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      order,
    );
  });
  it("preserves PR number/url and the actual merge confirmation", async () => {
    const pr = {
      id: "pr",
      userId: "user-1",
      repositoryId: null,
      sessionId: null,
      title: "Fix",
      body: null,
      headBranch: "fix",
      baseBranch: "main",
      status: "open",
      additions: null,
      deletions: null,
      number: 42,
      url: "https://example.test/pr/42",
      mergedAt: null,
      planningTaskId: null,
      createdAt: "now",
      updatedAt: null,
    };
    mocks.prs.mockResolvedValue([pr]);
    mocks.merge.mockResolvedValue({ success: true, mergedAt: "now" });
    expect(await rpc("projects.pullRequest.list").call({ limit: 50 })).toEqual([
      pr,
    ]);
    expect(
      await rpc("projects.pullRequest.merge").call({ pullRequestId: "pr" }),
    ).toEqual({ success: true, mergedAt: "now" });
  });
  it("scopes unseen transition reads and acknowledgements to the authenticated user", async () => {
    const rows = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sessionId: "session-1",
        transition: "completed",
        payload: { title: "Done" },
        createdAt: "now",
      },
    ];
    findOutbox.mockResolvedValue(rows);
    updateWhere.mockResolvedValue(undefined);
    expect(await rpc("notification.unseenTransitions").call(undefined)).toEqual(
      { count: 1, rows },
    );
    const dialect = new PgDialect({ casing: "snake_case" });
    const readQuery = dialect.sqlToQuery(findOutbox.mock.calls[0]![0].where);
    expect(readQuery.params).toEqual(["user-1"]);
    expect(readQuery.sql).toContain('"seen_at" is null');
    expect(
      await rpc("notification.markTransitionsSeen").call({
        ids: [rows[0]!.id],
      }),
    ).toEqual({ ok: true });
    const writeQuery = dialect.sqlToQuery(updateWhere.mock.calls[0]![0]);
    expect(writeQuery.params).toEqual(["user-1", rows[0]!.id]);
    expect(writeQuery.sql).toContain('"seen_at" is null');
  });
  it("rejects invalid native mutation inputs before any handler runs", () => {
    expect(() =>
      Schema.decodeUnknownSync(MarkTransitionsSeenRpc.payloadSchema)({
        ids: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(MarkTransitionsSeenRpc.payloadSchema)({
        ids: ["not-an-id"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ReorderQueueRpc.payloadSchema)({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workItemIds: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SetNotificationPreferenceRpc.payloadSchema)({
        type: "task_completed",
        channel: "sms",
        enabled: true,
      }),
    ).toThrow();
  });

  it("normalizes legacy API key scopes before encoding the listing", async () => {
    findApiKeys.mockResolvedValue([
      {
        id: "key-1",
        name: "Daemon",
        keyPrefix: "bob_",
        permissions: { scopes: ["read", "daemon", "*"] },
        lastUsedAt: null,
        expiresAt: null,
        createdAt: "2026-09-16",
      },
    ]);
    expect(await rpc("settings.listApiKeys").call(undefined)).toEqual([
      {
        id: "key-1",
        name: "Daemon",
        keyPrefix: "bob_",
        permissions: ["read", "daemon", "*"],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: "2026-09-16",
      },
    ]);
  });
  it("encodes denied preference changes and missing PR merge targets", async () => {
    mocks.update.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Denied" }),
    );
    await expect(
      rpc("settings.updatePreferences").call({ theme: "dark" }),
    ).rejects.toMatchObject({ _tag: "UnauthorizedError" });
    mocks.merge.mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND", message: "No PR" }),
    );
    await expect(
      rpc("projects.pullRequest.merge").call({ pullRequestId: "missing" }),
    ).rejects.toMatchObject({ _tag: "NotFoundError" });
  });
});
