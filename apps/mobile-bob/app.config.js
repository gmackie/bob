/** @type {import('expo/config').ConfigContext} */

const APP_VARIANT =
  process.env.APP_VARIANT ?? process.env.APP_ENV ?? "development";
const isHostedEnv =
  APP_VARIANT === "production" || APP_VARIANT === "staging";
const API_URL =
  process.env.API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_PRODUCTION_API_URL ??
  "https://bob.blder.bot";
const AUTH_URL =
  process.env.AUTH_URL ??
  process.env.EXPO_PUBLIC_AUTH_URL ??
  API_URL;
const OODA_API_URL =
  process.env.OODA_API_URL ??
  process.env.EXPO_PUBLIC_OODA_API_URL ??
  (isHostedEnv ? "https://ooda.blder.bot" : "http://localhost:3001");
const GATEWAY_PUBLIC_URL =
  process.env.GATEWAY_PUBLIC_URL ??
  process.env.EXPO_PUBLIC_GATEWAY_URL ??
  (isHostedEnv ? "wss://ws.blder.bot" : undefined);
const updatesConfig = isHostedEnv
  ? {
      fallbackToCacheTimeout: 0,
      url: "https://u.expo.dev/e1dd0ab0-4dc1-40f8-b066-7cb91fde1759",
    }
  : { enabled: false };

const SENTRY_DSN = process.env.SENTRY_DSN;
const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

const getAppName = () => {
  switch (APP_VARIANT) {
    case "production":
      return "Bob";
    case "preview":
      return "Bob (Preview)";
    default:
      return "Bob (Dev)";
  }
};

const getVariantIcon = () => {
  if (APP_VARIANT === "development") return "./assets/icon-dev.png";
  if (APP_VARIANT === "preview") return "./assets/icon-preview.png";
  return "./assets/icon.png";
};

const getBundleId = () => {
  const base = "com.gmacko.bob";
  switch (APP_VARIANT) {
    case "production":
      return base;
    case "preview":
      return `${base}.preview`;
    default:
      return `${base}.dev`;
  }
};

const getScheme = () => {
  switch (APP_VARIANT) {
    case "production":
      return "bob";
    case "preview":
      return "bob-preview";
    default:
      return "bob-dev";
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
    // Enables native push: adds the iOS aps-environment entitlement and the
    // Android notification channel/icon. APNs key + FCM credentials are
    // configured on EAS (eas credentials), not here.
    "expo-notifications",
  ];

  if (sentryPlugin) {
    plugins.push(sentryPlugin);
  }

  return {
    ...config,
    name: getAppName(),
    slug: "bob",
    scheme: getScheme(),
    version: "0.1.0",
    orientation: "default",
    icon: getVariantIcon(),
    userInterfaceStyle: "automatic",
    updates: updatesConfig,
    runtimeVersion: "1.0.0",
    newArchEnabled: true,
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: getBundleId(),
      supportsTablet: true,
      icon:
        APP_VARIANT === "production" ? "./assets/icon.png" : getVariantIcon(),
      infoPlist: {
        CFBundleDisplayName: getAppName(),
        ITSAppUsesNonExemptEncryption: false,
        "UISupportedInterfaceOrientations~ipad": [
          "UIInterfaceOrientationPortrait",
          "UIInterfaceOrientationPortraitUpsideDown",
          "UIInterfaceOrientationLandscapeLeft",
          "UIInterfaceOrientationLandscapeRight",
        ],
        // Wake the app for background/data pushes so the badge + delivery work
        // even when the app isn't foregrounded.
        UIBackgroundModes: ["remote-notification"],
      },
      entitlements: {
        // "development" for dev/preview builds; EAS overrides to "production"
        // for release/TestFlight automatically via the push credentials.
        "aps-environment":
          APP_VARIANT === "production" ? "production" : "development",
      },
    },
    android: {
      package: getBundleId(),
      adaptiveIcon: {
        foregroundImage:
          APP_VARIANT === "production" ? "./assets/icon.png" : getVariantIcon(),
        backgroundColor:
          APP_VARIANT === "development"
            ? "#4a6de5"
            : APP_VARIANT === "preview"
              ? "#eef2fb"
              : "#18181b",
      },
      edgeToEdgeEnabled: true,
    },
    extra: {
      APP_ENV: APP_VARIANT,
      API_URL,
      AUTH_URL,
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
