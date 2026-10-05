import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPrFact,
  buildReviewRequest,
  commitUrlFor,
  deriveSummary,
  deriveTestPlan,
  issueReference,
  kanbangerOrigin,
  parseChangesRequested,
  postDeliveryReport,
} from "../kanbangerDelivery";

afterEach(() => vi.restoreAllMocks());

const CONFIG = { apiUrl: "https://tasks.gmac.io/graphql", apiKey: "lc_test_key" };
const WORKSPACE = "11111111-2222-4333-8444-555555555555";
const ISSUE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const review = () =>
  buildReviewRequest({
    externalIssueId: ISSUE,
    workItemId: "wi-1",
    revision: 2,
    summary: "Added the thing.",
    testPlan: ["Open the page", "Click save"],
    prUrl: "https://git.forgegraf.com/gmackie/bob/pulls/7",
    commitUrl: "https://git.forgegraf.com/gmackie/bob/commit/abc123",
  });

describe("postDeliveryReport", () => {
  it("201 → ok, POSTs the report to the workspace delivery endpoint with the bearer key", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json(201, { event: { id: "ev-1" }, issueId: ISSUE }));

    const result = await postDeliveryReport(CONFIG, WORKSPACE, review());

    expect(result).toEqual({ ok: true, issueId: ISSUE });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : url).toBe(`https://tasks.gmac.io/api/workspaces/${WORKSPACE}/delivery`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer lc_test_key");
    expect(JSON.parse(init?.body as string)).toEqual(review());
  });

  it("409 progress-gate-blocked → gate_blocked (caller must not claim readiness)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(409, { _tag: "Conflict", reason: "progress-gate-blocked" }),
    );

    const result = await postDeliveryReport(CONFIG, WORKSPACE, review());

    expect(result).toMatchObject({ ok: false, kind: "gate_blocked", status: 409, reason: "progress-gate-blocked" });
  });

  it("404 (endpoint not deployed / issue not found) → unavailable, so callers fall back", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    const result = await postDeliveryReport(CONFIG, WORKSPACE, review());

    expect(result).toMatchObject({ ok: false, kind: "unavailable", status: 404 });
  });

  it("a network error never throws — it is reported as unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const result = await postDeliveryReport(CONFIG, WORKSPACE, review());

    expect(result).toMatchObject({ ok: false, kind: "unavailable", status: null, detail: "fetch failed" });
  });

  it("other 4xx → rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(400, { _tag: "BadRequest", message: "nope" }));

    const result = await postDeliveryReport(CONFIG, WORKSPACE, review());

    expect(result).toMatchObject({ ok: false, kind: "rejected", status: 400 });
  });

  it("never sends the key to real Linear", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    const result = await postDeliveryReport(
      { apiUrl: "https://api.linear.app/graphql", apiKey: "lin_api_x" },
      WORKSPACE,
      review(),
    );

    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("report payloads", () => {
  it("review_request carries the documented shape", () => {
    expect(review()).toEqual({
      issueId: ISSUE,
      kind: "review_request",
      status: "ready",
      subject: "bob:review:wi-1",
      externalId: "bob:review:wi-1:2",
      title: "Ready for review",
      summary: "Added the thing.",
      url: "https://git.forgegraf.com/gmackie/bob/pulls/7",
      producer: "bob",
      payload: {
        testPlan: ["Open the page", "Click save"],
        artifacts: [
          { type: "pr", url: "https://git.forgegraf.com/gmackie/bob/pulls/7" },
          { type: "commit", url: "https://git.forgegraf.com/gmackie/bob/commit/abc123" },
        ],
      },
    });
  });

  it("identifier-keyed work items send `identifier` instead of `issueId`", () => {
    expect(issueReference("GMA-612")).toEqual({ identifier: "GMA-612" });
    expect(issueReference(ISSUE)).toEqual({ issueId: ISSUE });
    const report = buildReviewRequest({
      externalIssueId: "GMA-612",
      workItemId: "wi-9",
      revision: 1,
      summary: "s",
      testPlan: [],
    });
    expect(report).toMatchObject({ identifier: "GMA-612", externalId: "bob:review:wi-9:1" });
    expect(report).not.toHaveProperty("issueId");
    expect(report).not.toHaveProperty("url");
  });

  it("PR facts use the PR URL as subject and externalId", () => {
    expect(buildPrFact(ISSUE, "https://h/o/r/pulls/3", "merged")).toMatchObject({
      issueId: ISSUE,
      kind: "pr",
      status: "merged",
      subject: "https://h/o/r/pulls/3",
      externalId: "https://h/o/r/pulls/3",
      producer: "bob",
    });
  });
});

describe("kanbangerOrigin", () => {
  it("accepts the configured clone and rejects Linear / unset / credentialed URLs", () => {
    expect(kanbangerOrigin("https://tasks.gmac.io/graphql")).toBe("https://tasks.gmac.io");
    expect(kanbangerOrigin(null)).toBeNull();
    expect(kanbangerOrigin("https://api.linear.app/graphql")).toBeNull();
    expect(kanbangerOrigin("https://user:pw@tasks.gmac.io/graphql")).toBeNull();
    expect(kanbangerOrigin("http://tasks.gmac.io/graphql")).toBeNull();
  });
});

describe("deriveTestPlan / deriveSummary", () => {
  it("prefers the agent's own Test plan section", () => {
    const agentSummary = "Did X.\n\n## Test plan\n1. Open /settings\n2. Toggle dark mode\n\n## Notes\n- n/a";
    expect(deriveTestPlan({ agentSummary, prUrl: "https://h/o/r/pulls/1" })).toEqual([
      "Open /settings",
      "Toggle dark mode",
      "Review the diff in https://h/o/r/pulls/1.",
      "Check the PR's CI checks are green.",
    ]);
  });

  it("falls back to the issue's acceptance criteria", () => {
    const issueDescription = "Body\n\n## Acceptance criteria\n- [ ] Users can export CSV\n- [x] Export is paginated";
    expect(deriveTestPlan({ issueDescription })).toEqual([
      "Confirm: Users can export CSV",
      "Confirm: Export is paginated",
    ]);
  });

  it("summary uses the agent message and links the PR", () => {
    expect(deriveSummary({ agentSummary: "Fixed it.", prUrl: "https://h/o/r/pulls/1" })).toBe(
      "Fixed it.\n\nPull request: https://h/o/r/pulls/1",
    );
    expect(deriveSummary({ prTitle: "[Bob] T" })).toBe("[Bob] T");
  });

  it("commitUrlFor handles Forgejo and GitHub PR URLs", () => {
    expect(commitUrlFor("https://git.forgegraf.com/o/r/pulls/12", "abc")).toBe("https://git.forgegraf.com/o/r/commit/abc");
    expect(commitUrlFor("https://github.com/o/r/pull/12", "abc")).toBe("https://github.com/o/r/commit/abc");
    expect(commitUrlFor("https://github.com/o/r/pull/12", null)).toBeNull();
  });
});

describe("parseChangesRequested", () => {
  it("extracts the reviewer's note", () => {
    expect(parseChangesRequested("Changes requested: please add a test")).toBe("please add a test");
    expect(parseChangesRequested("**Changes requested:** rename it\nand more")).toBe("rename it\nand more");
    expect(parseChangesRequested("Changes requested:")).toBe("");
    expect(parseChangesRequested("LGTM")).toBeNull();
    expect(parseChangesRequested(null)).toBeNull();
  });
});
