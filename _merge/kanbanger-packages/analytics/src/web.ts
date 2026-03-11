import posthog from "posthog-js";
import type { AnalyticsEvent, EventProperties } from "./events";

let initialized = false;

export function initAnalytics() {
  if (initialized || typeof window === "undefined") return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.warn("PostHog key not configured");
    return;
  }

  posthog.init(key, {
    api_host: "https://us.i.posthog.com",
    capture_pageview: false,
  });

  initialized = true;
}

export function identify(userId: string, properties?: EventProperties) {
  if (!initialized) return;
  posthog.identify(userId, properties);
}

export function track(event: AnalyticsEvent, properties?: EventProperties) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function reset() {
  if (!initialized) return;
  posthog.reset();
}
