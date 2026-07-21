import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  projectDeploySecretBindings,
  sessionSecretUsages,
  sessionSecrets,
} from "@bob/db/schema";
import { encryptSessionSecretValue } from "../../services/crypto/sessionSecretVault.js";
import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/update surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const { forgeGraphSecretClient } = vi.hoisted(() => ({
  forgeGraphSecretClient: {
    upsertDeploySecret: vi.fn(),
    listDeploySecrets: vi.fn(),
  },
}));

vi.mock("../../services/forgegraph/config", () => ({
  isForgeGraphEnabled: () => true,
  requireForgeGraphClient: () => forgeGraphSecretClient,
}));

let appRouter: typeof import("../../root").appRouter;

// Loose "row bag" mocks: these hold whatever partial values each test's
// insert()/update() call happens to pass, not the full DB row shape (no
// server-applied defaults are simulated), so `Record<string, unknown>` is
// the honest type — not the real table's `$inferSelect`.
type MockRow = Record<string, unknown>;
const secretRows: MockRow[] = [];
const usageRows: MockRow[] = [];
const bindingRows: MockRow[] = [];

const queryMocks = {
  chatConversationsFindFirst: vi.fn(),
  projectsFindFirst: vi.fn(),
  sessionSecretsFindFirst: vi.fn(),
  sessionSecretsFindMany: vi.fn(),
  sessionSecretUsagesFindMany: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    chatConversations: {
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    projects: {
      findFirst: queryMocks.projectsFindFirst,
    },
    sessionSecrets: {
      findFirst: queryMocks.sessionSecretsFindFirst,
      findMany: queryMocks.sessionSecretsFindMany,
    },
    sessionSecretUsages: {
      findMany: queryMocks.sessionSecretUsagesFindMany,
    },
  },
  insert: vi.fn((table: unknown) => ({
    values: vi.fn((vals: MockRow | MockRow[]) => {
      const rows = Array.isArray(vals) ? vals : [vals];
      if (table === sessionSecrets) secretRows.push(...rows);
      if (table === sessionSecretUsages) usageRows.push(...rows);
      if (table === projectDeploySecretBindings) bindingRows.push(...rows);
      return {
        returning: vi.fn(() => Promise.resolve(rows)),
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
        })),
      };
    }),
  })),
  delete: vi.fn((table: unknown) => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => {
        if (table === sessionSecrets) {
          const deleted = secretRows.splice(0, secretRows.length);
          return Promise.resolve(deleted);
        }
        if (table === projectDeploySecretBindings) {
          const deleted = bindingRows.splice(0, bindingRows.length);
          return Promise.resolve(deleted);
        }
        return Promise.resolve([]);
      }),
    })),
  })),
  update: vi.fn((table: unknown) => ({
    set: vi.fn((patch: MockRow) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          if (table === sessionSecrets && secretRows.length > 0) {
            const updated = { ...secretRows[0], ...patch };
            secretRows.splice(0, 1, updated);
            return Promise.resolve([updated]);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
  })),
});

const fakeSession = {
  session: {
    id: "auth-session-1",
    createdAt: new Date("2026-03-30T00:00:00.000Z"),
    updatedAt: new Date("2026-03-30T00:00:00.000Z"),
    userId: "user-1",
    expiresAt: new Date("2026-03-31T00:00:00.000Z"),
    token: "token-1",
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: "user-1",
    createdAt: new Date("2026-03-30T00:00:00.000Z"),
    updatedAt: new Date("2026-03-30T00:00:00.000Z"),
    email: "test@example.com",
    emailVerified: true,
    name: "Test User",
    image: null,
  },
};

const createCaller = () =>
  appRouter.createCaller({
    session: fakeSession,
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

const createApiKeyCaller = () =>
  appRouter.createCaller({
    session: fakeSession,
    authApi: { getSession: vi.fn() },
    apiKeyAuth: {
      keyId: "gateway-key",
      permissions: ["write"] as const,
      user: fakeSession.user,
      userId: fakeSession.user.id,
    },
    db: makeDbMock(),
  } as unknown as TRPCContext);

beforeAll(async () => {
  process.env.GIT_TOKEN_ENCRYPTION_KEY = "test-session-secret-encryption-key";
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@localhost:5432/test";
  ({ appRouter } = await import("../../root"));
});

beforeEach(() => {
  secretRows.length = 0;
  usageRows.length = 0;
  bindingRows.length = 0;
  Object.values(queryMocks).forEach((mock) => mock.mockReset());
  queryMocks.sessionSecretUsagesFindMany.mockResolvedValue([]);
  forgeGraphSecretClient.upsertDeploySecret.mockReset();
  forgeGraphSecretClient.listDeploySecrets.mockReset();
});

describe("session secret schema and router", () => {
  it("defines the new secret tables", () => {
    expect(sessionSecrets).toBeDefined();
    expect(sessionSecretUsages).toBeDefined();
    expect(projectDeploySecretBindings).toBeDefined();
  }, 60_000);

  it("creates session secrets and stores related usage metadata", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: "user-1",
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    queryMocks.sessionSecretsFindMany.mockResolvedValue([]);

    const caller = createCaller();
    const result = await caller.secrets.createSessionSecret({
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      label: "GitHub token",
      handle: "github-token",
      value: "ghp_secret",
      transport: "template",
      policy: {
        allowedTemplates: ["gh-api"],
        redactOutput: true,
      },
    });

    expect(result).toBeDefined();
    expect(secretRows).toHaveLength(1);
    const createdSecretId = secretRows[0]?.id;
    if (typeof createdSecretId !== "string") {
      throw new Error("expected the created secret row to have a string id");
    }

    await caller.secrets.markSecretUsed({
      secretId: createdSecretId,
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      executor: "broker",
      templateId: "gh-api",
    });

    expect(usageRows).toHaveLength(1);
  });

  it("lists secret metadata without returning plaintext", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: "user-1",
    });
    queryMocks.sessionSecretsFindMany.mockResolvedValueOnce([
      {
        id: "secret-1",
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        label: "GitHub token",
        handle: "github-token",
        transport: "template",
        status: "active",
        provider: "bob",
        valueCiphertext: "encrypted",
        valueIv: "iv",
        valueTag: "tag",
      },
    ]);

    const caller = createCaller();
    const result = await caller.secrets.listSessionSecrets({
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result).toHaveLength(1);
    const [secret] = result;
    if (!secret) throw new Error("expected a secret in the result");
    expect(secret.handle).toBe("github-token");
    // The router's return type omits valueCiphertext/valueIv/valueTag (and
    // never included `value`) entirely — verify they're genuinely absent
    // from the raw response, not just typed as undefined.
    expect("value" in secret).toBe(false);
    expect("valueCiphertext" in secret).toBe(false);
  });

  it("returns plaintext only for the trusted gateway execution path", async () => {
    const encrypted = encryptSessionSecretValue("ghp_secret", "secret-1");
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: "user-1",
    });
    queryMocks.sessionSecretsFindFirst.mockResolvedValueOnce({
      id: "secret-1",
      userId: "user-1",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      label: "GitHub token",
      handle: "github-token",
      transport: "template",
      status: "active",
      provider: "bob",
      policy: { allowedTemplates: ["gh-api"], redactOutput: true },
      valueCiphertext: encrypted.ciphertext,
      valueIv: encrypted.iv,
      valueTag: encrypted.tag,
    });

    const caller = createApiKeyCaller();
    const result = await caller.secrets.getSessionSecretForExecution({
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      handle: "github-token",
    });

    expect(result.handle).toBe("github-token");
    expect(result.value).toBe("ghp_secret");
    // The router's return type for this trusted execution path never
    // includes the ciphertext fields — verify they're genuinely absent.
    expect("valueCiphertext" in result).toBe(false);
  });

  it("returns a metadata-only manifest for gateway and MCP consumers", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: "user-1",
    });
    queryMocks.sessionSecretsFindMany.mockResolvedValueOnce([
      {
        id: "secret-1",
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        label: "GitHub token",
        handle: "github-token",
        transport: "template",
        status: "active",
        provider: "bob",
        policy: {
          allowedTemplates: ["gh-api"],
        },
        valueCiphertext: "encrypted",
        valueIv: "iv",
        valueTag: "tag",
      },
    ]);

    const caller = createApiKeyCaller();
    const result = await caller.secrets.getSessionSecretManifest({
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result).toEqual([
      expect.objectContaining({
        handle: "github-token",
        label: "GitHub token",
        policy: {
          allowedTemplates: ["gh-api"],
        },
      }),
    ]);
    // The manifest's return type never includes plaintext/ciphertext value
    // fields — verify it's genuinely absent, not just undefined.
    expect(result[0] && "value" in result[0]).toBe(false);
  });

  it("rejects creating a secret for a session owned by another user", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.secrets.createSessionSecret({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        label: "GitHub token",
        handle: "github-token",
        value: "ghp_secret",
        transport: "template",
        policy: {
          allowedTemplates: ["gh-api"],
          redactOutput: true,
        },
      }),
    ).rejects.toThrow(/session/i);
  });

  it("deletes a session secret", async () => {
    secretRows.push({
      id: "secret-1",
      userId: "user-1",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      label: "GitHub token",
      handle: "github-token",
    });
    queryMocks.sessionSecretsFindFirst.mockResolvedValueOnce(secretRows[0]);

    const caller = createCaller();
    const result = await caller.secrets.deleteSessionSecret({
      secretId: "secret-1",
    });

    expect(result.deleted).toBe(1);
    expect(secretRows).toHaveLength(0);
  });

  it("creates deploy bindings for forgegraph promotion", async () => {
    queryMocks.projectsFindFirst.mockResolvedValue({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const caller = createCaller();

    const result = await caller.secrets.upsertProjectDeployBinding({
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      environment: "staging",
      label: "GitHub token",
      forgegraphKey: "GITHUB_TOKEN",
      externalRef: "fg://secret/staging/github-token",
      transport: "template",
      templateId: "gh-api",
    });

    expect(result).toBeDefined();
    expect(bindingRows).toHaveLength(1);
  });

  it("promotes a session secret into a ForgeGraph deploy secret binding", async () => {
    const encrypted = encryptSessionSecretValue("ghp_secret", "secret-1");
    secretRows.push({
      id: "secret-1",
      userId: "user-1",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      label: "GitHub token",
      handle: "github-token",
      transport: "template",
      provider: "bob",
      status: "active",
      valueCiphertext: encrypted.ciphertext,
      valueIv: encrypted.iv,
      valueTag: encrypted.tag,
      policy: { allowedTemplates: ["gh-api"], redactOutput: true },
    });
    queryMocks.sessionSecretsFindFirst.mockResolvedValueOnce(secretRows[0]);
    queryMocks.projectsFindFirst.mockResolvedValue({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    forgeGraphSecretClient.upsertDeploySecret.mockResolvedValueOnce({
      ref: "fg://secret/staging/github-token",
    });

    const caller = createCaller();
    const result = await caller.secrets.promoteSessionSecret({
      secretId: "secret-1",
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      environment: "staging",
      forgegraphKey: "GITHUB_TOKEN",
    });

    expect(forgeGraphSecretClient.upsertDeploySecret).toHaveBeenCalledWith({
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      environment: "staging",
      key: "GITHUB_TOKEN",
      value: "ghp_secret",
    });
    expect(result.externalRef).toBe("fg://secret/staging/github-token");
    expect(secretRows[0]?.provider).toBe("forgegraph");
    expect(secretRows[0]?.status).toBe("promoted");
    expect(bindingRows).toHaveLength(1);
  });
});
