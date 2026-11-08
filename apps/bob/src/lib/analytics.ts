// Journey analytics for observe.gmac.io (BOB-67, DATFLR-9).
// Thin, typed wrapper over the /dataflare.js loader. Every call is a no-op when the
// loader is absent (kill switch, DNT/GPC, excluded routes, tests, server render).
// Never pass emails, names or free text: ids of non-personal things, enums and counts only.

export type JourneyEvent =
  | "project_created"
  | "plan_committed"
  | "work_item_dispatched"
  | "pull_request_merged";

export type JourneyProps = Record<string, string | number | boolean | null>;

interface DataflareApi {
  track: (event: string, props?: JourneyProps) => void;
  identify: (id: string, props?: JourneyProps) => void;
  reset: () => void;
}

declare global {
  interface Window {
    dataflare?: DataflareApi;
  }
}

// `window` is absent during server render and in Node tests.
const dataflare = (): DataflareApi | undefined => globalThis.window?.dataflare;

export function track(event: JourneyEvent, props?: JourneyProps): void {
  try {
    dataflare()?.track(event, props ?? {});
  } catch {
    // Analytics must never break the app.
  }
}

export function identifyUser(id: string, props?: JourneyProps): void {
  if (!id) return;
  try {
    dataflare()?.identify(id, props ?? {});
  } catch {
    // Analytics must never break the app.
  }
}

export function resetUser(): void {
  try {
    dataflare()?.reset();
  } catch {
    // Analytics must never break the app.
  }
}
