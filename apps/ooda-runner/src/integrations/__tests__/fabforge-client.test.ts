import { describe, expect, it, vi } from "vitest";

import { createFabForgeClient } from "../fabforge-client";

const workOrder = {
  id: "work-order-1",
  workspaceId: "workspace-1",
  title: "OODA enclosure",
  description: null,
  status: "candidate",
  repositoryId: "gmackie/ooda-handheld",
  manualSourceKey: "ooda:delivery-1",
  targetType: "manifest",
  groupingKey: "ooda-enclosure",
  processTypes: ["three_d_print", "inspection"],
  manifestPath: "fabforge.project.json",
  createdAt: "2026-08-09T13:00:00.000Z",
  updatedAt: "2026-08-09T13:00:00.000Z",
};

describe("createFabForgeClient", () => {
  it("uses workspace-scoped v0 routes with the FabForge bearer token", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const data = url.includes("candidate-work-orders")
          ? { created: true, workOrder }
          : { workOrders: [workOrder] };
        return new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const client = createFabForgeClient({
      apiUrl: "https://fabforge.example/",
      apiToken: "fft_ooda_token",
      fetch: fetcher,
    });

    await expect(client.listWorkOrders("workspace-1")).resolves.toEqual([
      workOrder,
    ]);
    await expect(
      client.createCandidateWorkOrder({
        workspaceId: "workspace-1",
        manualSourceKey: "ooda:delivery-1",
        title: "OODA enclosure",
        status: "candidate",
        targetType: "manifest",
        groupingStrategy: "manifest",
        groupingKey: "ooda-enclosure",
      }),
    ).resolves.toEqual({ created: true, workOrder });

    expect(fetcher.mock.calls[0]?.[0].toString()).toContain(
      "/api/fabrication/v0/work-orders?workspaceId=workspace-1",
    );
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain(
      "/api/fabrication/v0/candidate-work-orders",
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer fft_ooda_token",
      );
    }
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain(
      '"manualSourceKey":"ooda:delivery-1"',
    );
  });
});
