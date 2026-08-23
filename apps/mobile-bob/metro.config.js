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

// Node-only builtins that leak in transitively (see metro-shims/README) get
// redirected to a stub before falling through to nativewind's resolver.
const NODE_BUILTIN_SHIMS = {
  "node:crypto": path.join(__dirname, "metro-shims", "node-crypto-stub.js"),
};

const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_BUILTIN_SHIMS[moduleName]) {
    return { type: "sourceFile", filePath: NODE_BUILTIN_SHIMS[moduleName] };
  }
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
