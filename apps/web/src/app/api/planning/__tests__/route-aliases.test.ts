import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("planning route aliases", () => {
  it("re-exports the planning dashboard metrics route", async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    process.env.AUTH_GITHUB_ID ??= "github-test-id";
    process.env.AUTH_GITHUB_SECRET ??= "github-test-secret";
    Object.assign(process.env, { NODE_ENV: "development" });
    const planningRoute = await import("../dashboard-metrics/route");
    const legacyRoute = await import("../../kanbanger/dashboard-metrics/route");

    expect(planningRoute.GET).toBe(legacyRoute.GET);
  });

  it("re-exports the planning project repo mapping route", async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    Object.assign(process.env, { NODE_ENV: "development" });
    const planningRoute = await import("../projects/[projectId]/repo/route");
    const legacyRoute = await import(
      "../../kanbanger/projects/[projectId]/repo/route"
    );

    expect(planningRoute.POST).toBe(legacyRoute.POST);
    expect(planningRoute.DELETE).toBe(legacyRoute.DELETE);
  });

  it("re-exports the planning repo sync route", async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    process.env.AUTH_GITHUB_ID ??= "github-test-id";
    process.env.AUTH_GITHUB_SECRET ??= "github-test-secret";
    Object.assign(process.env, { NODE_ENV: "development" });
    const planningRoute = await import("../sync-repos/route");
    const legacyRoute = await import("../../kanbanger/sync-repos/route");

    expect(planningRoute.POST).toBe(legacyRoute.POST);
  });
});
