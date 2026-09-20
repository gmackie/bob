import { afterEach, describe, expect, it, vi } from "vitest";

import { reportKanbangerTrace } from "./traceReport";

afterEach(() => vi.restoreAllMocks());
const reference = {
  taskRunId: "task-run",
  attemptId: "attempt",
  traceId: "1".repeat(32),
  rootSpanId: "2".repeat(16),
  outcome: "running" as const,
  captureState: "pending" as const,
  services: ["bob"],
};
describe("Kanbanger trace report", () => {
  it("posts the strict metadata envelope to the configured clone", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    await reportKanbangerTrace(
      { apiUrl: "https://tasks.gmac.io/graphql", apiKey: "test-key" },
      "issue-1",
      reference,
    );
    expect((fetch.mock.calls[0]?.[0] as URL).href).toBe(
      "https://tasks.gmac.io/api/trpc/attachment.recordTrace",
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      json: { issueId: "issue-1", reference },
    });
  });
  it("does not send clone metadata or credentials to another Linear host", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await reportKanbangerTrace(
      { apiUrl: "https://api.linear.app/graphql", apiKey: "test-key" },
      "issue-1",
      reference,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
