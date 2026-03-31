import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  projectsFindFirst: vi.fn(),
  projectsFindMany: vi.fn(),
  workItemsFindMany: vi.fn(),
  repositoriesFindFirst: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
  workspaceMembersFindMany: vi.fn(),
};

const tempDirs: string[] = [];

const insertReturningMock = vi.fn();
const insertValuesMock = vi.fn(() => ({
  returning: insertReturningMock,
}));
const insertMock = vi.fn(() => ({
  values: insertValuesMock,
}));

const updateReturningMock = vi.fn();
const updateWhereMock = vi.fn(() => ({
  returning: updateReturningMock,
}));
const updateSetMock = vi.fn(() => ({
  where: updateWhereMock,
}));
const updateMock = vi.fn(() => ({
  set: updateSetMock,
}));

function createTempRepo(paths: Array<{ path: string; content?: string }>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "bob-project-router-"));
  tempDirs.push(root);

  for (const entry of paths) {
    const absolutePath = path.join(root, entry.path);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (entry.content === undefined) {
      mkdirSync(absolutePath, { recursive: true });
      continue;
    }
    writeFileSync(absolutePath, entry.content, "utf8");
  }

  return root;
}

const makeDbMock = () => ({
  query: {
    projects: {
      findFirst: queryMocks.projectsFindFirst,
      findMany: queryMocks.projectsFindMany,
    },
    workItems: {
      findMany: queryMocks.workItemsFindMany,
    },
    repositories: {
      findFirst: queryMocks.repositoriesFindFirst,
    },
    workspaceMembers: {
      findFirst: queryMocks.workspaceMembersFindFirst,
      findMany: queryMocks.workspaceMembersFindMany,
    },
  },
  insert: insertMock,
  update: updateMock,
});

const createCaller = () =>
  appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: "user-1",
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null as any,
    db: makeDbMock() as any,
  });

describe("project router", () => {
  const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
    insertReturningMock.mockReset();
    insertValuesMock.mockClear();
    insertMock.mockClear();
    updateReturningMock.mockReset();
    updateWhereMock.mockClear();
    updateSetMock.mockClear();
    updateMock.mockClear();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns mapped repository context and create-gmacko-app capability details", async () => {
    const repoPath = createTempRepo([
      { path: "apps/nextjs/.storybook" },
      { path: "apps/nextjs/playwright.config.ts", content: "export default {};" },
      { path: "apps/expo/.maestro" },
      { path: "packages/ui/src" },
      {
        path: "packages/ui/src/button.stories.tsx",
        content: "export const Default = {};",
      },
      { path: "packages/api/src" },
      { path: "packages/db/src" },
      { path: "docs/ai" },
      { path: ".claude/skills/gstack" },
      {
        path: ".claude/skills/create-gmacko-app-workflow/SKILL.md",
        content: "# create-gmacko-app-workflow",
      },
      {
        path: "gmacko.integrations.json",
        content: JSON.stringify({ integrations: ["stripe"] }),
      },
    ]);

    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Acme App",
      key: "ACME",
      status: "in_progress",
      description: "A detected app",
      color: "#334155",
      automationSettings: {
        reactFrontend: true,
      },
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    queryMocks.repositoriesFindFirst.mockResolvedValueOnce({
      id: "repo-1",
      name: "acme-app",
      path: repoPath,
      remoteProvider: "github",
      remoteOwner: "acme",
      remoteName: "acme-app",
      remoteUrl: "git@github.com:acme/acme-app.git",
    });
    queryMocks.workItemsFindMany.mockResolvedValueOnce([]);

    const caller = createCaller();
    const result = await caller.project.get({ id: projectId });

    expect(result?.linkedRepository).toMatchObject({
      id: "repo-1",
      name: "acme-app",
      path: repoPath,
      remoteProvider: "github",
      remoteOwner: "acme",
      remoteName: "acme-app",
    });
    expect(result?.capabilities.template).toMatchObject({
      slug: "create-gmacko-app",
      hasAiWorkflow: true,
      hasClaudeGstack: true,
      hasRepoSkill: true,
      hasStorybook: true,
      hasIntegrationManifest: true,
      hasPlaywright: true,
      hasMaestro: true,
      frontendApps: ["apps/nextjs"],
    });
  });

  it("rejects get when the caller is not a member of the project's workspace", async () => {
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Acme App",
      key: "ACME",
      status: "in_progress",
      description: "A detected app",
      color: "#334155",
      automationSettings: {},
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(caller.project.get({ id: projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects create when the caller is not a member of the workspace", async () => {
    insertReturningMock.mockResolvedValueOnce([
      {
        id: projectId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Acme App",
        key: "ACME",
      },
    ]);
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.project.create({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Acme App",
        key: "acme",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects list when the caller is not a member of the workspace", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);
    queryMocks.projectsFindMany.mockResolvedValueOnce([]);
    queryMocks.workItemsFindMany.mockResolvedValueOnce([]);

    const caller = createCaller();

    await expect(
      caller.project.list({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects automation updates when the caller is not a member of the project's workspace", async () => {
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      automationSettings: {},
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);
    updateReturningMock.mockResolvedValueOnce([
      {
        id: projectId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        automationSettings: {
          autoDispatch: true,
        },
      },
    ]);

    const caller = createCaller();

    await expect(
      caller.project.updateAutomationSettings({
        projectId,
        settings: {
          autoDispatch: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
