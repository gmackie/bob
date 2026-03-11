import { describe, expect, it, vi } from "vitest";

import {
  BobControlError,
  buildBobControlSignature,
  createBobControlClient,
} from "../src/services/bob-control-client";

describe("Bob control client", () => {
  it("signs start requests with timestamp and idempotency headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          issueId: "550e8400-e29b-41d4-a716-446655440000",
          issueIdentifier: "ENG-123",
          executionBackend: "bob",
          taskRunId: "run_123",
          sessionId: "session_123",
          sessionUrl: "https://bob.example.internal/chat/session_123",
          workflowStatus: "in_progress",
          runStatus: "in_progress",
          latestSummary: "Bootstrapped repository context",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const client = createBobControlClient(
      {
        baseUrl: "https://bob.example.internal",
        sharedSecret: "super-secret",
      },
      {
        fetch: fetchMock as typeof fetch,
        now: () => 1_710_000_000_000,
        randomUUID: () => "idem-123",
      },
    );

    const input = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440010",
      projectId: "550e8400-e29b-41d4-a716-446655440011",
      issueId: "550e8400-e29b-41d4-a716-446655440000",
      issueIdentifier: "ENG-123",
      actor: {
        id: "550e8400-e29b-41d4-a716-446655440099",
        name: "Alice Example",
      },
      repository: {
        id: "repo_123",
        fullName: "acme/example",
      },
    };

    const result = await client.startIssueSession(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, init] = fetchMock.mock.calls[0] as [
      string,
      {
        method?: string;
        body?: string;
        headers: Record<string, string>;
      },
    ];

    const requestBody = JSON.stringify(input);

    expect(requestUrl).toBe(
      "https://bob.example.internal/api/integrations/kanbanger/issues/start",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(requestBody);
    expect(init.headers["X-Kanbanger-Timestamp"]).toBe("1710000000000");
    expect(init.headers["Idempotency-Key"]).toBe("idem-123");
    expect(init.headers["X-Kanbanger-Signature"]).toBe(
      buildBobControlSignature(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
          timestamp: "1710000000000",
          idempotencyKey: "idem-123",
          body: requestBody,
        },
        "super-secret",
      ),
    );
    expect(result).toEqual({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
      issueIdentifier: "ENG-123",
      executionBackend: "bob",
      taskRunId: "run_123",
      sessionId: "session_123",
      sessionUrl: "https://bob.example.internal/chat/session_123",
      workflowStatus: "in_progress",
      runStatus: "in_progress",
      latestSummary: "Bootstrapped repository context",
    });
  });

  it("throws typed errors for non-ok Bob responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ISSUE_ALREADY_ACTIVE",
            message: "Issue already has an active Bob run",
          },
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const client = createBobControlClient(
      {
        baseUrl: "https://bob.example.internal",
        sharedSecret: "super-secret",
      },
      {
        fetch: fetchMock as typeof fetch,
        now: () => 1_710_000_000_000,
        randomUUID: () => "idem-456",
      },
    );

    await expect(
      client.stopIssueSession({
        workspaceId: "550e8400-e29b-41d4-a716-446655440010",
        projectId: "550e8400-e29b-41d4-a716-446655440011",
        issueId: "550e8400-e29b-41d4-a716-446655440000",
        issueIdentifier: "ENG-123",
        actor: {
          id: "550e8400-e29b-41d4-a716-446655440099",
        },
        reason: "Handing back to a human",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BobControlError>>({
        name: "BobControlError",
        status: 409,
        code: "ISSUE_ALREADY_ACTIVE",
        message: "Issue already has an active Bob run",
      }),
    );
  });
});
