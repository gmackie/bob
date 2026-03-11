export function initEdgeSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  // Keeping edge-specific Sentry initialization intentionally lightweight and dependency-light
  // while the runtime migrates to a Vite-native stack.
}
