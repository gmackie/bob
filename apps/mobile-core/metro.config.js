const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = withNativewind(getDefaultConfig(__dirname), {
  input: "./src/styles.css",
});
config.transformerPath = require.resolve("./metro.native-css.cjs");
// Workspace contracts use Node-style .js specifiers for TypeScript sources.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  try {
    return resolveRequest(context, name, platform);
  } catch (error) {
    if (
      (name.startsWith("./") || name.startsWith("../")) &&
      name.endsWith(".js")
    ) {
      return resolveRequest(context, name.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
