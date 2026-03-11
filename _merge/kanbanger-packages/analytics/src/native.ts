import PostHog from "posthog-react-native";
import type { AnalyticsEvent } from "./events";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Properties = Record<string, JsonValue>;

let client: PostHog | null = null;

export async function initAnalytics() {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.warn("PostHog key not configured");
    return;
  }

  client = new PostHog(key, {
    host: "https://us.i.posthog.com",
  });
}

export function identify(userId: string, properties?: Properties) {
  client?.identify(userId, properties);
}

export function track(event: AnalyticsEvent, properties?: Properties) {
  client?.capture(event, properties);
}

export function reset() {
  client?.reset();
}
