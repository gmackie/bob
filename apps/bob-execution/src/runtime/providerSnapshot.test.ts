import { beforeEach, describe, expect, it, vi } from "vitest";

const selectRows: unknown[][] = [];
const fetchMock = vi.fn();

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

  it("uses the Linear external id and rewrites issue URLs without changing the API host", async () => {
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
      json: async () => ({
        data: {
          issue: {
            id: "linear-issue-1",
            title: "Replace Bob runner",
            identifier: "ENG-42",
            description: "Description",
            url: "https://linear.app/gmac/issue/ENG-42/replace-bob-runner",
            priority: 2,
            assignee: { id: "user-1" },
            labels: { nodes: [{ name: "backend" }] },
          },
        },
      }),
    });

    const result = await snapshotTaskFromProvider({
      id: "work-item-1",
      externalId: "linear-issue-1",
      externalProvider: "linear",
      identifier: "ENG-42",
      title: "Old title",
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
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).variables).toEqual({
      id: "linear-issue-1",
    });
    expect(result.snapshot).toMatchObject({
      externalId: "linear-issue-1",
      externalProvider: "linear",
      linearWebBaseUrl: "https://tasks.gmac.io",
      url: "https://tasks.gmac.io/gmac/issue/ENG-42/replace-bob-runner",
    });
  });
});
