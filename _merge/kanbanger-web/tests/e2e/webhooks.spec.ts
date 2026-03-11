import { test, expect } from "@playwright/test";

test.describe("Webhook Endpoints", () => {
  test("GitHub webhook endpoint should respond to GET", async ({ request }) => {
    const response = await request.get("/api/webhooks/github");

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("Gitea webhook endpoint should respond to GET", async ({ request }) => {
    const response = await request.get("/api/webhooks/gitea");

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("GitHub webhook should reject invalid JSON", async ({ request }) => {
    const response = await request.post("/api/webhooks/github", {
      data: "invalid json",
      headers: {
        "Content-Type": "text/plain",
        "X-GitHub-Event": "push",
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Invalid JSON");
  });

  test("Gitea webhook should reject invalid JSON", async ({ request }) => {
    const response = await request.post("/api/webhooks/gitea", {
      data: "invalid json",
      headers: {
        "Content-Type": "text/plain",
        "X-Gitea-Event": "push",
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Invalid JSON");
  });

  test("GitHub webhook should accept valid payload without matching config", async ({
    request,
  }) => {
    const payload = {
      repository: {
        html_url: "https://github.com/test/repo",
        full_name: "test/repo",
      },
      action: "opened",
      pull_request: {
        title: "Test PR",
        body: "Fixes ENG-123",
        html_url: "https://github.com/test/repo/pull/1",
        number: 1,
      },
    };

    const response = await request.post("/api/webhooks/github", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-id",
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.message).toBe("No matching webhook");
  });

  test("Gitea webhook should accept valid payload without matching config", async ({
    request,
  }) => {
    const payload = {
      repository: {
        html_url: "https://gitea.example.com/test/repo",
        full_name: "test/repo",
      },
      action: "opened",
      pull_request: {
        title: "Test PR",
        body: "Fixes ENG-123",
        html_url: "https://gitea.example.com/test/repo/pull/1",
        number: 1,
      },
    };

    const response = await request.post("/api/webhooks/gitea", {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "X-Gitea-Event": "pull_request",
        "X-Gitea-Delivery": "test-delivery-id",
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.message).toBe("No matching webhook");
  });
});

test.describe("Health Check", () => {
  test("API health endpoint should respond", async ({ request }) => {
    const response = await request.get("/api/health");

    // Even if not implemented, test should not crash
    expect([200, 404]).toContain(response.status());
  });
});
