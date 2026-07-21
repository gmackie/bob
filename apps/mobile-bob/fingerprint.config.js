const assert = require("node:assert");

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ["PackageJsonScriptsAll", "ExpoConfigExtraSection"],
  fileHookTransform: (source, chunk, isEndOfFile) => {
    if (source.type !== "contents" || source.id !== "expoConfig") return chunk;
    assert(
      isEndOfFile,
      "The Expo config fingerprint source must be a single chunk.",
    );
    const config = JSON.parse(chunk.toString());
    config.plugins = config.plugins?.map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== "@sentry/react-native/expo") {
        return plugin;
      }
      return [
        plugin[0],
        {
          ...plugin[1],
          organization: "<runtime-value>",
          project: "<runtime-value>",
        },
      ];
    });
    return JSON.stringify(config);
  },
};
