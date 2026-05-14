/** @type {import('expo/config').ConfigContext} */

const APP_ENV = process.env.APP_ENV ?? "development";
const isHostedEnv = APP_ENV === "production" || APP_ENV === "staging";
const API_URL =
  process.env.API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_PRODUCTION_API_URL ??
  (isHostedEnv ? "https://bob.blder.bot" : "http://localhost:3000");
const OODA_API_URL =
  process.env.OODA_API_URL ??
  process.env.EXPO_PUBLIC_OODA_API_URL ??
  (isHostedEnv ? "https://ooda.blder.bot" : "http://localhost:3001");
const GATEWAY_PUBLIC_URL =
  process.env.GATEWAY_PUBLIC_URL ??
  process.env.EXPO_PUBLIC_GATEWAY_URL ??
  (isHostedEnv ? "wss://ws.blder.bot" : undefined);

const SENTRY_DSN = process.env.SENTRY_DSN;
const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

const getAppName = () => {
  switch (APP_ENV) {
    case "production":
      return "Bob";
    case "staging":
      return "Bob (Beta)";
    default:
      return "Bob (Dev)";
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
      "expo-speech-recognition",
      {
        microphonePermission: "Allow Bob to use the microphone for voice prompts.",
        speechRecognitionPermission: "Allow Bob to transcribe voice prompts.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"],
      },
    ],
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
    slug: "bob",
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
      OODA_API_URL,
      GATEWAY_PUBLIC_URL,
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
