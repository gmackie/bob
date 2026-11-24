import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const components = "react-native-css/components";

// Expo Router registers its link preview during startup. Metro can resolve
// either NativeWind entry point depending on the importing module.
it.each([
  ["import", fileURLToPath(import.meta.resolve(components))],
  ["require", require.resolve(components)],
])("exposes NativeComponentRegistry through the %s entry point", (_, entry) => {
  expect(Reflect.has(require(entry), "NativeComponentRegistry")).toBe(true);
});
