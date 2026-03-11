import { afterEach, describe, expect, it } from "vitest";

import { getExecutionServiceConfig } from "./config.js";

describe("execution config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("enables the gateway by default in development", () => {
    delete process.env.BOB_EXECUTION_ENABLE_GATEWAY;
    delete process.env.BOB_EXECUTION_GATEWAY_BIN;
    process.env.NODE_ENV = "development";

    const config = getExecutionServiceConfig();

    expect(config.gateway.enabled).toBe(true);
    expect(config.gateway.command).toBe("pnpm");
    expect(config.gateway.args).toEqual(["--filter", "@bob/gateway", "dev"]);
  });

  it("switches the gateway child to start in production", () => {
    process.env.NODE_ENV = "production";

    const config = getExecutionServiceConfig();

    expect(config.gateway.args).toEqual(["--filter", "@bob/gateway", "start"]);
  });

  it("allows the gateway child to be disabled through env", () => {
    process.env.BOB_EXECUTION_ENABLE_GATEWAY = "false";

    const config = getExecutionServiceConfig();

    expect(config.gateway.enabled).toBe(false);
  });
});
