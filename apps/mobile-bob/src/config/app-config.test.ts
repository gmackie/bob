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

// EVERY profile — development included — resolves EAS Updates against its own
// channel. That reverses the older "dev never touches EAS Updates" rule on
// purpose: docs/ota-updates.md defines the release path as publish and verify
// on `development` first, then beta, then republish the verified bundle to
// production. Dev builds are dev-clients (Debug, developmentClient: true) and
// still boot from the Expo dev server; the channel is what makes an update
// publishable to them for verification.
const EXPECTED_UPDATES = {
  checkAutomatically: "ON_LOAD",
  fallbackToCacheTimeout: 0,
  url: "https://u.expo.dev/e1dd0ab0-4dc1-40f8-b066-7cb91fde1759",
};

describe("Expo app config", () => {
  it("resolves EAS Updates for development builds so updates can be verified there first", () => {
    const config = loadConfig({ APP_ENV: "development" });

    expect(config.updates).toEqual(EXPECTED_UPDATES);
  });

  it("keeps EAS Updates enabled for hosted staging builds", () => {
    const config = loadConfig({ APP_ENV: "staging" });

    expect(config.updates).toEqual(EXPECTED_UPDATES);
  });
});

describe("EAS build profiles", () => {
  it("gives every profile its own update channel while keeping development a debug dev-client", () => {
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

    // Per docs/ota-updates.md: development publishes to its own channel and is
    // the first stop in the release path — but stays a Debug dev-client build,
    // so it still runs off the dev server rather than an OTA bundle.
    expect(easConfig.build.development?.channel).toBe("development");
    expect(easConfig.build.development?.ios?.buildConfiguration).toBe("Debug");
    expect(easConfig.build.development?.android?.gradleCommand).toBe(
      ":app:assembleDebug",
    );
    expect(easConfig.build.beta?.channel).toBe("beta");
    expect(easConfig.build.production?.channel).toBe("production");
  });
});

describe("iPad tablet configuration", () => {
  it("keeps EAS iPad builds tablet-enabled with explicit landscape support", () => {
    const config = loadConfig({ APP_ENV: "production" }) as {
      ios?: {
        infoPlist?: Record<string, unknown>;
        supportsTablet?: boolean;
      };
      orientation?: string;
    };

    expect(config.orientation).toBe("default");
    expect(config.ios?.supportsTablet).toBe(true);
    expect(config.ios?.infoPlist?.["UISupportedInterfaceOrientations~ipad"]).toEqual(
      expect.arrayContaining([
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ]),
    );
  });
});
