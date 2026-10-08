// The debug bridge links only into the development client.
// Preview, beta, staging, and production must not compile this pod.
const variant = process.env.APP_VARIANT;
const includeWhenUnset = true;
const includeBridge =
  variant === "development" ||
  ((variant == null || variant === "") && includeWhenUnset);

module.exports = {
  dependencies: {
    "gstack-debug-bridge": {
      platforms: {
        ios: includeBridge ? {} : null,
        android: null,
      },
    },
  },
};
