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

// Updates come from Preflight (BOB-113). Every variant resolves them against
// its own Preflight channel, development included: docs/ota-updates.md
// publishes and verifies on development first, then preview, then production.
const PREFLIGHT_OTA = {
  checkAutomatically: "ON_LOAD",
  fallbackToCacheTimeout: 0,
  url: "https://preflight.forgegraf.com/api/preflight/v1/ota/bob",
  codeSigningCertificate: "./certs/ota-code-signing.pem",
  codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
};

function expectedUpdates(channel: string) {
  return {
    ...PREFLIGHT_OTA,
    requestHeaders: { "expo-channel-name": channel },
  };
}

describe("Expo app config", () => {
  it("resolves Preflight updates on the development channel for development builds", () => {
    const config = loadConfig({ APP_ENV: "development", APP_VARIANT: undefined });

    expect(config.updates).toEqual(expectedUpdates("development"));
  });

  it("sends hosted staging and preview builds to the preview channel", () => {
    expect(
      loadConfig({ APP_ENV: "staging", APP_VARIANT: undefined }).updates,
    ).toEqual(expectedUpdates("preview"));
    expect(
      loadConfig({ APP_VARIANT: "preview", APP_ENV: "staging" }).updates,
    ).toEqual(expectedUpdates("preview"));
  });

  it("sends production builds to the production channel", () => {
    const config = loadConfig({ APP_VARIANT: "production" });

    expect(config.updates).toEqual(expectedUpdates("production"));
    expect(config.runtimeVersion).toBe("0.1.1");
  });

  it("ships the certificate the Preflight vault signs with", () => {
    const pem = readFileSync(
      resolve(__dirname, "../../certs/ota-code-signing.pem"),
      "utf8",
    );

    expect(pem).toContain("BEGIN CERTIFICATE");
    expect(pem).not.toContain("PRIVATE KEY");
  });

  it("routes preview builds to the hosted OODA API", () => {
    const config = loadConfig({ APP_VARIANT: "preview", APP_ENV: "staging" }) as {
      extra?: { OODA_API_URL?: string };
    };

    expect(config.extra?.OODA_API_URL).toBe("https://ooda.blder.bot");
  });
});

describe("native updates configuration", () => {
  // The store build uses the committed ios/ and android/ projects as they are
  // (no prebuild), so they must carry the same updates settings.
  it("points the committed iOS and Android projects at Preflight with the same certificate", () => {
    const pem = readFileSync(
      resolve(__dirname, "../../certs/ota-code-signing.pem"),
      "utf8",
    ).trim();
    const expoPlist = readFileSync(
      resolve(__dirname, "../../ios/BobDev/Supporting/Expo.plist"),
      "utf8",
    );
    const manifest = readFileSync(
      resolve(__dirname, "../../android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );

    expect(expoPlist).toContain(PREFLIGHT_OTA.url);
    expect(expoPlist).toContain(pem);
    expect(expoPlist).not.toContain("u.expo.dev");
    expect(manifest).toContain(PREFLIGHT_OTA.url);
    expect(manifest).toContain(pem.replaceAll("\n", "&#10;"));
    expect(manifest).not.toContain("u.expo.dev");
  });
});

describe("iPad tablet configuration", () => {
  it("keeps iPad builds tablet-enabled with explicit landscape support", () => {
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
