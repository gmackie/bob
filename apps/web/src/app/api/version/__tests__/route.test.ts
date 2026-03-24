import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("version API route", () => {
  it("returns version, buildTime, and env", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body).toHaveProperty("version");
    expect(body.version).toBe("0.0.4");
    expect(body).toHaveProperty("buildTime");
    expect(new Date(body.buildTime).toISOString()).toBe(body.buildTime);
    expect(body).toHaveProperty("env");
    expect(typeof body.env).toBe("string");
  });
});
