import { Platform } from "react-native";

/**
 * Lightweight tablet usage analytics.
 *
 * Tracks key interaction metrics to validate the "monitoring surface"
 * hypothesis from the design doc:
 * - Does the user reach for the tablet instead of waiting for the desk?
 * - Which features get used (monitoring vs. planning vs. code inspection)?
 * - What's the session duration pattern?
 *
 * Implementation: logs to console in dev, ready for PostHog integration.
 * To enable PostHog: import posthog and replace the track() calls.
 */

const isTablet = Platform.OS === "ios" && Platform.isPad;

interface AnalyticsEvent {
  event: string;
  properties: Record<string, string | number | boolean>;
}

// Buffer events for batch sending (PostHog integration point)
const buffer: AnalyticsEvent[] = [];
let sessionStartTime: number | null = null;

function track(event: string, properties: Record<string, string | number | boolean> = {}) {
  if (!isTablet) return;

  const entry: AnalyticsEvent = {
    event,
    properties: {
      ...properties,
      platform: "tablet",
      ts: new Date().toISOString(),
    },
  };

  buffer.push(entry);

  if (__DEV__) {
    console.log("[TabletAnalytics]", event, properties);
  }

  // TODO: PostHog integration
  // posthog.capture(event, entry.properties);
}

// --- Session lifecycle ---

export function trackTabletSessionStart() {
  sessionStartTime = Date.now();
  track("tablet_session_start");
}

export function trackTabletSessionEnd() {
  const duration = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 1000) : 0;
  track("tablet_session_end", { duration_seconds: duration });
  sessionStartTime = null;
}

// --- Feature usage ---

export function trackAgentSelected(sessionId: string, status: string) {
  track("tablet_agent_selected", { session_id: sessionId, agent_status: status });
}

export function trackWorkItemSelected(workItemId: string) {
  track("tablet_work_item_selected", { work_item_id: workItemId });
}

export function trackPlanningSessionOpened(sessionId: string) {
  track("tablet_planning_session_opened", { session_id: sessionId });
}

export function trackInspectorOpened(tab: string) {
  track("tablet_inspector_opened", { initial_tab: tab });
}

// --- Actions ---

export function trackAgentAction(action: "approve" | "reject" | "stop" | "send_input") {
  track("tablet_agent_action", { action });
}

export function trackFilterChanged(filter: string) {
  track("tablet_filter_changed", { filter });
}

export function trackSidebarTabChanged(tab: "agents" | "items") {
  track("tablet_sidebar_tab", { tab });
}

// --- Connection ---

export function trackConnectionStateChanged(state: string) {
  track("tablet_connection_state", { state });
}

// --- Export buffer for debugging ---

export function getAnalyticsBuffer(): readonly AnalyticsEvent[] {
  return buffer;
}
