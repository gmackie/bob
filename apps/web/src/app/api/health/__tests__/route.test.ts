import { describe, expect, it, vi, beforeEach } from "vitest";

describe("health route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns status ok with expected fields", async () => {
    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      version: expect.any(String),
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it("returns a valid ISO timestamp", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it("returns a non-negative uptime", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
