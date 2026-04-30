import { describe, expect, it, vi, afterEach } from "vitest";

describe("validateEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns no errors when all required vars are set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("OODA_STORAGE_ROOT", "/tmp/ooda");

    const { validateEnvironment } = await import("../env-validation");
    const result = validateEnvironment();
    expect(result.errors).toHaveLength(0);
  });

  it("returns error with problem/cause/fix when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("OODA_STORAGE_ROOT", "/tmp/ooda");

    const { validateEnvironment } = await import("../env-validation");
    const result = validateEnvironment();
    const dbError = result.errors.find((e) => e.variable === "DATABASE_URL");
    expect(dbError).toBeDefined();
    expect(dbError!.problem).toContain("DATABASE_URL");
    expect(dbError!.fix).toBeTruthy();
  });

  it("returns warnings (not errors) for optional vault/research vars", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("OODA_STORAGE_ROOT", "/tmp/ooda");
    // vault vars intentionally unset

    const { validateEnvironment } = await import("../env-validation");
    const result = validateEnvironment();
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.variable === "RESEARCH_API_URL")).toBe(
      true,
    );
  });
});
