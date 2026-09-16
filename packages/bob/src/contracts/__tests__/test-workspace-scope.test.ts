import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

import config from "../../../vitest.config";

it("leaves nested workspace test suites to their own package runners", () => {
  const sourceRoot = new URL("../../", import.meta.url);
  const nestedTestPackages = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const manifest = new URL(`${entry.name}/package.json`, sourceRoot);
      if (!existsSync(manifest)) return false;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        scripts?: { test?: string };
      };
      return Boolean(pkg.scripts?.test);
    })
    .map((entry) => `src/${entry.name}/**`);

  expect(config.test?.exclude).toEqual(
    expect.arrayContaining(nestedTestPackages),
  );
});
