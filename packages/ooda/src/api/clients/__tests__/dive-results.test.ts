import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchBackendClient } from "../research-backend";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/v1/__fixtures__/dive-result-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const response = {
  exploration_id: "11111111-1111-4111-8111-111111111111",
  status: "done",
  summary_md: null,
  papers: [],
  clusters: fixture.cluster_summary.clusters,
  edge_counts_by_kind: { cites: 1 },
  vault_schema: "personal_vault",
  result: fixture,
};
afterEach(() => vi.unstubAllGlobals());
describe("versioned dive results", () => {
  it("rejects malformed persisted result data instead of casting it into the product", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              ...response,
              result: { ...fixture, edge_count: "wrong" },
            }),
          ),
        ),
    );
    await expect(
      new ResearchBackendClient("https://test.invalid", "test-token").getDiveResults(
        response.exploration_id,
      ),
    ).rejects.toThrow();
  });
  it("reads the shared Python writer fixture without losing clusters or partial errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
    );
    expect(
      await new ResearchBackendClient("https://test.invalid", "test-token").getDiveResults(
        response.exploration_id,
      ),
    ).toEqual(response);
  });
});
