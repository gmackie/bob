import { describe, expect, it } from "vitest";
import { readOracleConfig } from "./oracle-config";

describe("readOracleConfig", () => {
  it("is disabled when either var is missing", () => {
    expect(readOracleConfig({ OODA_API_URL: "https://x" }).enabled).toBe(false);
    expect(readOracleConfig({ OODA_ORACLE_TOKEN: "t" }).enabled).toBe(false);
    expect(readOracleConfig({}).enabled).toBe(false);
  });
  it("is enabled and carries values when both vars are present", () => {
    const cfg = readOracleConfig({ OODA_API_URL: "https://x", OODA_ORACLE_TOKEN: "t" });
    expect(cfg).toEqual({ enabled: true, apiUrl: "https://x", token: "t" });
  });
});
