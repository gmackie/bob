/** @type {import('expo/config').ConfigContext} */

const APP_VARIANT =
  process.env.APP_VARIANT ?? process.env.APP_ENV ?? "development";
const isHostedEnv =
  APP_VARIANT === "production" ||
  APP_VARIANT === "staging" ||
  APP_VARIANT === "preview";
const API_URL =
  process.env.API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_PRODUCTION_API_URL ??
  "https://bob.blder.bot";
const AUTH_URL =
  process.env.AUTH_URL ?? process.env.EXPO_PUBLIC_AUTH_URL ?? API_URL;
const OODA_API_URL =
  process.env.OODA_API_URL ??
  process.env.EXPO_PUBLIC_OODA_API_URL ??
  (isHostedEnv ? "https://ooda.blder.bot" : "http://localhost:3001");
const GATEWAY_PUBLIC_URL =
  process.env.GATEWAY_PUBLIC_URL ??
  process.env.EXPO_PUBLIC_GATEWAY_URL ??
  (isHostedEnv ? "wss://ws.blder.bot" : undefined);
// OTA updates come from Preflight (BOB-113), not EAS Update. The server signs
// every manifest with Bob's `ota_code_signing_key` from the Preflight vault;
// certs/ota-code-signing.pem is its public certificate, and a binary only
// accepts updates signed by the certificate it was built with. Preflight's
// channels are development, preview and production.
const PREFLIGHT_OTA_URL =
  process.env.PREFLIGHT_OTA_URL ??
  "https://preflight.forgegraf.com/api/preflight/v1/ota/bob";
const getUpdatesChannel = () => {
  if (APP_VARIANT === "production") return "production";
  if (APP_VARIANT === "preview" || APP_VARIANT === "staging") return "preview";
  return "development";
};
const updatesConfig = {
  checkAutomatically: "ON_LOAD",
  fallbackToCacheTimeout: 0,
  url: PREFLIGHT_OTA_URL,
  codeSigningCertificate: "./certs/ota-code-signing.pem",
  codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
  requestHeaders: { "expo-channel-name": getUpdatesChannel() },
};

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
      "expo-camera",
      {
        cameraPermission:
          "Allow Bob to use the camera to scan the sign-in QR code from Bob web.",
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "Allow Bob to use the microphone for voice prompts.",
        speechRecognitionPermission: "Allow Bob to transcribe voice prompts.",
        androidSpeechServicePackages: [
          "com.google.android.googlequicksearchbox",
        ],
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
    // Android notification channel/icon. The APNs key and FCM credentials
    // belong to the push sender (Preflight), not to this config.
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
    version: "0.1.1",
    orientation: "default",
    icon: getVariantIcon(),
    userInterfaceStyle: "automatic",
    updates: updatesConfig,
    // The bare workflow rejects runtime version *policies* outright:
    //   "You're currently using the bare workflow, where runtime version
    //    policies are not supported. You must set your runtime version manually."
    // It has to be a literal. "fingerprint" was accepted but hashed the bare
    // ios/ directory, which the build mutates after the fingerprint is computed
    // (pod install writes into ios/, the build number bumps
    // CURRENT_PROJECT_VERSION), so the runtime version calculated locally never
    // matched the one calculated during the build. A literal is identical on
    // both sides, and it is what Preflight OTA publishes against.
    // Build 40 uses Expo SDK 55 and receives OTA updates for runtime 0.1.1.
    runtimeVersion: "0.1.1-sdk58",
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
        // GMA-774: the SDLC item Live Activity (widget extension ios/BobLiveActivityWidget).
        NSSupportsLiveActivities: true,
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
      // EAS provides google-services.json as the GOOGLE_SERVICES_JSON file env
      // var; FCM registration needs it in the build. Local runs without it are
      // unchanged.
      ...(process.env.GOOGLE_SERVICES_JSON
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
        : {}),
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
