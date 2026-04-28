const APP_ENV = process.env.APP_ENV ?? "development";
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const getAppName = () => {
  switch (APP_ENV) {
    case "production": return "Gmacko";
    case "staging": return "Gmacko (Beta)";
    default: return "Gmacko (Dev)";
  }
};

const getBundleId = () => {
  const base = "io.gmac.gmacko";
  switch (APP_ENV) {
    case "production": return base;
    case "staging": return `${base}.beta`;
    default: return `${base}.dev`;
  }
};

module.exports = ({ config }) => ({
  ...config,
  name: getAppName(),
  slug: "gmacko",
  scheme: "gmacko",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  updates: { fallbackToCacheTimeout: 0 },
  newArchEnabled: true,
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: getBundleId(),
    supportsTablet: true,
    infoPlist: {
      CFBundleDisplayName: getAppName(),
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: getBundleId(),
    adaptiveIcon: { backgroundColor: "#111113" },
    edgeToEdgeEnabled: true,
  },
  extra: { APP_ENV, API_URL },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
    reactCanary: true,
    reactCompiler: true,
  },
  plugins: [
    ["expo-dev-client", { launchMode: "most-recent" }],
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    ["expo-splash-screen", {
      backgroundColor: "#111113",
      dark: { backgroundColor: "#111113" },
    }],
  ],
});
