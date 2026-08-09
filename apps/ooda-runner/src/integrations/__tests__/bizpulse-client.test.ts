import { describe, expect, it } from "vitest";

import { createBizPulseClient } from "../bizpulse-client";

const startup = {
  id: "venture-1",
  name: "Conversation to Work",
  slug: "conversation-to-work",
  portfolioRole: "incubating",
  lifecycleStage: "idea",
  operatorNotes: "OODA_IDEMPOTENCY_KEY: delivery-1",
  createdAt: "2026-08-08T20:00:00.000Z",
};

describe("createBizPulseClient", () => {
  it("calls the existing versioned tRPC startup contract with API-key authentication", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      return Response.json({
        result: { data: { json: url.includes("list") ? [startup] : startup } },
      });
    };
    const client = createBizPulseClient({
      apiUrl: "https://bizpulse.example/",
      apiKey: "biz_private_key",
      fetch: fetcher,
    });

    await expect(client.listStartups()).resolves.toEqual([startup]);
    await expect(
      client.getStartupBySlug("conversation-to-work"),
    ).resolves.toEqual(startup);
    await expect(
      client.createStartup({
        name: startup.name,
        slug: startup.slug,
        portfolioRole: "incubating",
        lifecycleStage: "idea",
        ownershipModel: "gmacko_owned",
        managingEntityName: "Gmacko LLC",
        operatorNotes: startup.operatorNotes,
      }),
    ).resolves.toEqual(startup);

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toContain(
        "https://bizpulse.example/api/trpc/startup.",
      );
      expect(new Headers(request.init?.headers).get("authorization")).toBe(
        "Bearer biz_private_key",
      );
      expect(new Headers(request.init?.headers).get("x-api-version")).toBe(
        "v1",
      );
    }
    expect(requests[2]?.init?.method).toBe("POST");
    expect(String(requests[2]?.init?.body)).toContain(
      '"lifecycleStage":"idea"',
    );
  });
});
