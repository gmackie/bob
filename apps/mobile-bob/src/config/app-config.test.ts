import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../../app.config.js");

const ORIGINAL_ENV = { ...process.env };

function loadConfig(env: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...env };
  delete require.cache[configPath];

  const createConfig = require(configPath) as (ctx: {
    config: Record<string, unknown>;
  }) => Record<string, unknown>;

  return createConfig({ config: {} });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete require.cache[configPath];
});

describe("Expo app config", () => {
  it("keeps development builds on Expo dev server instead of EAS Updates", () => {
    const config = loadConfig({ APP_ENV: "development" });

    expect(config.updates).toEqual({ enabled: false });
  });

  it("keeps EAS Updates enabled for hosted staging builds", () => {
    const config = loadConfig({ APP_ENV: "staging" });

    expect(config.updates).toEqual({
      fallbackToCacheTimeout: 0,
      url: "https://u.expo.dev/e1dd0ab0-4dc1-40f8-b066-7cb91fde1759",
    });
  });
});

describe("EAS build profiles", () => {
  it("does not attach an update channel to the development dev-client build", () => {
    const easConfig = JSON.parse(
      readFileSync(resolve(__dirname, "../../eas.json"), "utf8"),
    ) as {
      build: Record<
        string,
        {
          android?: { gradleCommand?: string };
          channel?: string;
          ios?: { buildConfiguration?: string };
        }
      >;
    };

    expect(easConfig.build.development?.channel).toBeUndefined();
    expect(easConfig.build.development?.ios?.buildConfiguration).toBe("Debug");
    expect(easConfig.build.development?.android?.gradleCommand).toBe(
      ":app:assembleDebug",
    );
    expect(easConfig.build.beta?.channel).toBe("beta");
    expect(easConfig.build.production?.channel).toBe("production");
  });
});
