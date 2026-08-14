import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { compile } = require("react-native-css/compiler") as {
  compile: (
    css: string,
    options: { filename: string; projectRoot: string },
  ) => { stylesheet: () => unknown };
};
const { normalizeTailwindForReactNativeCss } =
  require("../metro.react-native-css-transformer.cjs") as {
    normalizeTailwindForReactNativeCss: (css: string) => string;
  };

describe("native CSS normalization", () => {
  it("supplies transparent defaults for Tailwind shadow variables", () => {
    const css = [
      ".shadow {",
      "  --tw-shadow: 0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a;",
      "  box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow),",
      "    var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);",
      "}",
    ].join("\n");

    const normalized = normalizeTailwindForReactNativeCss(css);

    expect(normalized).toContain("var(--tw-shadow)");
    expect(normalized).not.toMatch(
      /var\(--tw-(?:inset-shadow|inset-ring-shadow|ring-offset-shadow|ring-shadow)\)/,
    );
    expect(() =>
      compile(normalized, {
        filename: "shadow-regression.css",
        projectRoot: process.cwd(),
      }).stylesheet(),
    ).not.toThrow();
  });
});
