import { afterEach, describe, expect, it, vi } from "vitest";

import { PINNED_TITLE } from "../destination.js";
import { digestTracker } from "../tracker.js";

const issue = {
  id: "old",
  url: "https://tracker/old",
  title: PINNED_TITLE,
  description: "Original history",
  team: { id: "team" },
  state: { type: "canceled" },
};
const tracker = () =>
  digestTracker({
    apiKey: "test",
    apiUrl: "https://tracker.test/graphql",
    teamId: "team",
    retireLocal: () => Promise.resolve(),
  });
const response = (data: unknown) => new Response(JSON.stringify({ data }));
interface RequestBody {
  query: string;
  variables: {
    after?: string;
    input: { description: string; stateId?: string };
  };
}
function parseRequest(init: RequestInit | undefined): RequestBody {
  if (typeof init?.body !== "string")
    throw new Error("Expected JSON request body");
  return JSON.parse(init.body) as RequestBody;
}
afterEach(() => vi.unstubAllGlobals());
describe("digest tracker wire behavior", () => {
  it("paginates historical cards and comments", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          issues: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: "next" },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          issues: { nodes: [issue], pageInfo: { hasNextPage: false } },
        }),
      )
      .mockResolvedValueOnce(
        response({
          issue: {
            comments: {
              nodes: [{ body: "new" }],
              pageInfo: { hasNextPage: true, endCursor: "older" },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          issue: {
            comments: {
              nodes: [{ body: "old" }],
              pageInfo: { hasNextPage: false },
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await tracker().find()).toEqual([issue]);
    expect(await tracker().comments("old")).toEqual(["new", "old"]);
    expect(parseRequest(fetch.mock.calls[1]?.[1]).variables.after).toBe("next");
    expect(parseRequest(fetch.mock.calls[3]?.[1]).variables.after).toBe(
      "older",
    );
  });
  it("creates only in a canceled state and fails if none exists", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ team: { states: { nodes: [] } } }));
    vi.stubGlobal("fetch", fetch);
    await expect(tracker().create()).rejects.toThrow(
      "canceled reporting state",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockResolvedValueOnce(
        response({
          team: { states: { nodes: [{ id: "cancel", type: "canceled" }] } },
        }),
      )
      .mockResolvedValueOnce(
        response({ issueCreate: { success: true, issue } }),
      );
    await tracker().create();
    expect(parseRequest(fetch.mock.calls[2]?.[1]).variables.input.stateId).toBe(
      "cancel",
    );
  });
  it("preserves descriptions and links histories without duplicating migration text", async () => {
    const requests: { input: { description: string } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        await Promise.resolve();
        const body = parseRequest(init);
        if (body.query.includes("team(id"))
          return response({
            team: { states: { nodes: [{ id: "cancel", type: "canceled" }] } },
          });
        requests.push(body.variables);
        return response({ issueUpdate: { success: true } });
      }),
    );
    const client = tracker();
    const history = [
      issue,
      { ...issue, id: "second", url: "https://tracker/second" },
    ];
    await client.retire(issue, issue, history);
    const description = requests[0]?.input.description ?? "";
    await client.retire({ ...issue, description }, issue, history);
    expect(requests[1]?.input.description).toBe(description);
    expect(description).toContain("Original history");
    expect(description).toContain("https://tracker/second");
  });
  it("does not treat missing data or unauthorized lookup as an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response("denied", { status: 403 }))
        .mockResolvedValueOnce(response({})),
    );
    await expect(tracker().find()).rejects.toThrow("403");
    await expect(tracker().find()).rejects.toThrow("missing issue connection");
  });
});
