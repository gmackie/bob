import { expect, test } from "@playwright/test";

test("/api/config returns JSON with required fields", async ({ request }) => {
  const res = await request.get("/api/config");
  expect(res.ok()).toBeTruthy();

  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toContain("application/json");

  const json = await res.json();
  expect(json).toHaveProperty("appName");
  expect(json).toHaveProperty("enableGithubAuth");
  expect(json).toHaveProperty("jeffMode");
  expect(json).toHaveProperty("allowedAgents");
});
