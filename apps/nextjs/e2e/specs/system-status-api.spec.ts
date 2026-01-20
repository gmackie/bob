import { expect, test } from "@playwright/test";

test("/api/system-status returns agent + host dependency info", async ({
  request,
}) => {
  const res = await request.get("/api/system-status");
  expect(res.ok()).toBeTruthy();

  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toContain("application/json");

  const json = await res.json();
  expect(json).toHaveProperty("timestamp");
  expect(json).toHaveProperty("agents");
  expect(Array.isArray(json.agents)).toBe(true);
  expect(json).toHaveProperty("hostDependencies");
});
