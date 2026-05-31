/** @type {import('expo/config').ConfigContext} */

const APP_ENV = process.env.APP_ENV ?? "development";
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const SENTRY_DSN = process.env.SENTRY_DSN;
const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

const getAppName = () => {
  switch (APP_ENV) {
    case "production":
      return "BizPulse";
    case "staging":
      return "BizPulse (Beta)";
    default:
      return "BizPulse (Dev)";
  }
};

const getBundleId = () => {
  const base = "com.gmacko.bob";
  switch (APP_ENV) {
    case "production":
      return base;
    case "staging":
      return `${base}.beta`;
    default:
      return `${base}.dev`;
  }
};

const getSentryConfig = () => {
  if (!SENTRY_DSN) return null;
  return [
    "@sentry/react-native/expo",
    {
      organization: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    },
  ];
};

/** @param {{ config: import('expo/config').ExpoConfig }} ctx */
module.exports = ({ config }) => {
  const sentryPlugin = getSentryConfig();
  const plugins = [
    ["expo-dev-client", { launchMode: "most-recent" }],
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#E4E4E7",
        image: "./assets/icon-light.png",
        dark: {
          backgroundColor: "#18181B",
          image: "./assets/icon-dark.png",
        },
      },
    ],
  ];

  if (sentryPlugin) {
    plugins.push(sentryPlugin);
  }

  return {
    ...config,
    name: getAppName(),
    slug: "bizpulse",
    scheme: "bob",
    version: "0.1.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    updates: {
      fallbackToCacheTimeout: 0,
      url: "https://u.expo.dev/e1dd0ab0-4dc1-40f8-b066-7cb91fde1759",
    },
    runtimeVersion: "1.0.0",
    newArchEnabled: true,
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: getBundleId(),
      supportsTablet: true,
      icon: "./assets/icon.png",
      infoPlist: {
        CFBundleDisplayName: getAppName(),
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: getBundleId(),
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#18181b",
      },
      edgeToEdgeEnabled: true,
    },
    extra: {
      APP_ENV,
      API_URL,
      SENTRY_DSN,
      POSTHOG_KEY,
      POSTHOG_HOST,
      eas: {
        projectId: "e1dd0ab0-4dc1-40f8-b066-7cb91fde1759",
      },
    },
    owner: "gmacko",
    experiments: {
      tsconfigPaths: true,
      typedRoutes: true,
      reactCanary: true,
      reactCompiler: true,
    },
    plugins,
  };
};
