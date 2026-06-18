// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, "node_modules", ".cache", "metro"),
  }),
];

/** @type {import('expo/metro-config').MetroConfig} */
const nativewindConfig = withNativewind(config, { input: "./src/styles.css" });

nativewindConfig.transformerPath = require.resolve(
  "./metro.react-native-css-transformer.cjs",
);

const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return nativewindResolveRequest(context, moduleName, platform);
  } catch (error) {
    if (
      (moduleName.startsWith("./") || moduleName.startsWith("../")) &&
      moduleName.endsWith(".js")
    ) {
      return nativewindResolveRequest(
        context,
        moduleName.slice(0, -".js".length),
        platform,
      );
    }

    throw error;
  }
};

module.exports = nativewindConfig;
