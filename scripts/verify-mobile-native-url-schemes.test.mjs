import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const mobile = new URL("../apps/mobile-bob/", import.meta.url);
const plist = readFileSync(new URL("ios/BobDev/Info.plist", mobile), "utf8");
const project = readFileSync(
  new URL("ios/BobDev.xcodeproj/project.pbxproj", mobile),
  "utf8",
);
const require = createRequire(import.meta.url);
const configPath = new URL("app.config.js", mobile).pathname;

for (const [configuration, variant] of [
  ["Debug", "development"],
  ["Release", "development"],
  ["Release-production", "production"],
]) {
  test(`${configuration} native URL handlers agree with Expo OAuth callbacks`, () => {
    const block = [...project.matchAll(
      /buildSettings = \{([\s\S]*?)\};\s*name = "?([^";]+)"?;/g,
    )].find((match) => match[2] === configuration && match[1].includes("INFOPLIST_FILE = BobDev/Info.plist;"));
    assert.ok(block, `Missing native app configuration ${configuration}`);
    const settings = Object.fromEntries([...block[1].matchAll(
      /^\s*(\w+) = "?([^";\n]+)"?;/gm,
    )].map((match) => [match[1], match[2]]));
    const handlers = [...plist.matchAll(
      /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g,
    )].flatMap((match) => [...match[1].matchAll(/<string>([^<]+)<\/string>/g)]
      .map((value) => value[1].replace(/\$\((\w+)\)/g, (_, key) => {
        assert.ok(settings[key], `Unresolved native build setting ${key}`);
        return settings[key];
      })));
    const original = process.env.APP_VARIANT;
    try {
      process.env.APP_VARIANT = variant;
      delete require.cache[require.resolve(configPath)];
      const expo = require(configPath)({ config: {} });
      assert.ok(handlers.includes(expo.scheme), `Native handlers ${handlers} cannot receive ${expo.scheme}:// OAuth callback`);
      assert.ok(handlers.includes(expo.ios.bundleIdentifier));
      assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, expo.ios.bundleIdentifier);
      if (variant === "production") assert.ok(!handlers.includes("bob-dev"));
    } finally {
      if (original === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = original;
      delete require.cache[require.resolve(configPath)];
    }
  });
}
