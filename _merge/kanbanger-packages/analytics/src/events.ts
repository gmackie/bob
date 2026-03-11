export const AnalyticsEvents = {
  PAGE_VIEW: "page_view",
  SIGN_UP: "sign_up",
  SIGN_IN: "sign_in",
  SIGN_OUT: "sign_out",
  PURCHASE_STARTED: "purchase_started",
  PURCHASE_COMPLETED: "purchase_completed",
} as const;

export type AnalyticsEvent =
  (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}
