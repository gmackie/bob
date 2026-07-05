import { beforeEach, describe, expect, it, vi } from "vitest";

const selectRows: unknown[][] = [];
const fetchMock = vi.fn<typeof fetch>();

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@bob/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: vi.fn((cb: (rows: unknown[]) => unknown) =>
            Promise.resolve(cb(selectRows.shift() ?? [])),
          ),
        })),
      })),
    })),
  },
}));

vi.mock("@bob/db/schema", () => ({
  projects: {
    id: "projects.id",
    planningProvider: "projects.planningProvider",
    linearProjectId: "projects.linearProjectId",
  },
  workspaceIntegrations: {
    workspaceId: "workspaceIntegrations.workspaceId",
    provider: "workspaceIntegrations.provider",
    enabled: "workspaceIntegrations.enabled",
    apiKey: "workspaceIntegrations.apiKey",
    linearTeamId: "workspaceIntegrations.linearTeamId",
    linearWebBaseUrl: "workspaceIntegrations.linearWebBaseUrl",
  },
}));

import { snapshotTaskFromProvider } from "./providerSnapshot.js";

describe("snapshotTaskFromProvider", () => {
  beforeEach(() => {
    selectRows.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rewrites Linear issue URLs through the configured clone domain without changing the API host", async () => {
    selectRows.push(
      [{ planningProvider: "linear", linearProjectId: "project-1" }],
      [
        {
          apiKey: "lin_key",
          linearTeamId: "team-1",
          linearWebBaseUrl: "https://tasks.gmac.io",
        },
      ],
    );

    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            issue: {
              id: "issue-1",
              title: "Fix dispatch",
              identifier: "ENG-42",
              description: "Description",
              url: "https://linear.app/gmac/issue/ENG-42/fix-dispatch",
              priority: 2,
              assignee: { id: "user-1" },
              labels: { nodes: [{ name: "bug" }] },
            },
          },
        }),
    } as unknown as Response);

    const result = await snapshotTaskFromProvider({
      id: "work-item-1",
      externalId: "issue-1",
      externalProvider: "linear",
      identifier: "ENG-42",
      title: "Old",
      description: null,
      workspaceId: "workspace-1",
      projectId: "project-1",
      assigneeId: null,
      labels: [],
      priority: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.any(Object),
    );
    const requestBody: unknown = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    );
    expect((requestBody as { variables: unknown }).variables).toEqual({
      id: "issue-1",
    });
    expect(result.snapshot?.url).toBe(
      "https://tasks.gmac.io/gmac/issue/ENG-42/fix-dispatch",
    );
    expect(result.snapshot?.externalProvider).toBe("linear");
    expect(result.snapshot?.externalId).toBe("issue-1");
    expect(result.snapshot?.linearWebBaseUrl).toBe("https://tasks.gmac.io");
  });
});
