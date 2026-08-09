import { describe, expect, it, vi } from "vitest";

import { createVeritasClient } from "../veritas-client";

const project = {
  id: "project-1",
  orgId: "org-1",
  name: "OODA handheld",
  slug: "ooda-delivery-hardware-1",
  description: "OODA delivery: delivery-hardware-1",
  firmwareRepoUrl: "https://github.com/gmackie/ooda-handheld-firmware",
  pcbRepoUrl: null,
  targetHardware: "ESP32-S3",
  autoValidate: false,
  createdAt: "2026-08-09T14:00:00.000Z",
  updatedAt: "2026-08-09T14:00:00.000Z",
};

describe("createVeritasClient", () => {
  it("uses Veritas project tRPC procedures with bearer authentication", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const data = url.includes("projects.list")
          ? { projects: [project] }
          : { project };
        return new Response(
          JSON.stringify({ result: { data: { json: data } } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    const client = createVeritasClient({
      apiUrl: "https://veritas.example/",
      apiToken: "vrt_12345678_12345678901234567890123456789012", // gitleaks:allow -- synthetic fixture
      fetch: fetcher,
    });

    await expect(client.listProjects("ooda-delivery")).resolves.toEqual([
      project,
    ]);
    await expect(client.getProject("project-1")).resolves.toEqual(project);
    await expect(
      client.createProject({
        name: "OODA handheld",
        slug: "ooda-delivery-hardware-1",
        description: "OODA delivery: delivery-hardware-1",
        firmwareRepoUrl: "https://github.com/gmackie/ooda-handheld-firmware",
        targetHardware: "ESP32-S3",
      }),
    ).resolves.toEqual(project);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain("projects.list");
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain("projects.get");
    expect(fetcher.mock.calls[2]?.[0].toString()).toContain("projects.create");
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer vrt_12345678_12345678901234567890123456789012", // gitleaks:allow -- synthetic fixture
      );
    }
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain(
      "ooda-delivery-hardware-1",
    );
  });

  it("returns null when Veritas reports that a linked project no longer exists", async () => {
    const client = createVeritasClient({
      apiUrl: "https://veritas.example",
      apiToken: "vrt_12345678_12345678901234567890123456789012", // gitleaks:allow -- synthetic fixture
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              json: {
                message: "Project not found",
                code: -32004,
                data: { code: "NOT_FOUND", httpStatus: 404 },
              },
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(client.getProject("missing-project")).resolves.toBeNull();
  });
});
