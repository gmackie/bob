import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  existsSyncMock,
  readdirSyncMock,
  statSyncMock,
  gitInitializeMock,
  gitAddRepositoryMock,
  agentInitializeMock,
  agentCleanupMock,
  terminalCleanupMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  gitInitializeMock: vi.fn(),
  gitAddRepositoryMock: vi.fn(),
  agentInitializeMock: vi.fn(),
  agentCleanupMock: vi.fn(),
  terminalCleanupMock: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  statSync: statSyncMock,
}));

vi.mock("os", () => ({
  homedir: () => "/Users/tester",
}));

vi.mock("@bob/legacy", () => ({
  getAgentCommand: vi.fn(),
}));

vi.mock("@bob/legacy/agents", () => ({
  agentFactory: {},
}));

vi.mock("@bob/legacy/services", () => ({
  DEFAULT_USER_ID: "default-user",
  GitService: vi.fn().mockImplementation(function GitService() {
    return {
      initialize: gitInitializeMock,
      addRepository: gitAddRepositoryMock,
    };
  }),
  AgentService: vi.fn().mockImplementation(function AgentService() {
    return {
      initialize: agentInitializeMock,
      cleanup: agentCleanupMock,
    };
  }),
  TerminalService: vi.fn().mockImplementation(function TerminalService() {
    return {
      cleanup: terminalCleanupMock,
    };
  }),
}));

describe("execution service manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__executionServiceManager;
    existsSyncMock.mockReturnValue(false);
    readdirSyncMock.mockReturnValue([]);
    statSyncMock.mockReturnValue({
      isDirectory: () => true,
    });
    gitInitializeMock.mockResolvedValue(undefined);
    gitAddRepositoryMock.mockResolvedValue(undefined);
    agentInitializeMock.mockResolvedValue(undefined);
    agentCleanupMock.mockResolvedValue(undefined);
  });

  it("initializes and auto-discovers repositories once", async () => {
    existsSyncMock.mockImplementation((path: string) => {
      if (path === "/Users/tester/bob-repos") return true;
      return path === "/Users/tester/bob-repos/repo-a/.git";
    });
    readdirSyncMock.mockReturnValue(["repo-a", "not-a-repo"]);
    statSyncMock.mockImplementation((path: string) => ({
      isDirectory: () => path !== "/Users/tester/bob-repos/not-a-repo",
    }));

    const { getServices } = await import("./services.js");

    const first = await getServices();
    const second = await getServices();

    expect(first.gitService).toBe(second.gitService);
    expect(gitInitializeMock).toHaveBeenCalledTimes(1);
    expect(agentInitializeMock).toHaveBeenCalledTimes(1);
    expect(gitAddRepositoryMock).toHaveBeenCalledWith(
      "/Users/tester/bob-repos/repo-a",
      "default-user",
    );
  });

  it("cleans up agent and terminal services and reinitializes on the next access", async () => {
    const { cleanupServices, getServices } = await import("./services.js");

    await getServices();
    await cleanupServices();
    await getServices();

    expect(agentCleanupMock).toHaveBeenCalledTimes(1);
    expect(terminalCleanupMock).toHaveBeenCalledTimes(1);
    expect(gitInitializeMock).toHaveBeenCalledTimes(2);
    expect(agentInitializeMock).toHaveBeenCalledTimes(2);
  });
});
