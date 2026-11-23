// GMA-774: following an SDLC item on the lock screen. The app starts the item's Live
// Activity, hands its push token to the edge (BOB-96 sends APNs liveactivity updates from
// then on, app running or not), updates it itself while the app has a fresher view, and
// tells the edge to stop when the activity ends or the user stops following.
// No agent text reaches the activity: its content is liveActivityContent, as the edge's is.
import { liveActivityContent } from "@bob/sdlc-view";
import type { EdgeView, LiveActivityApp, LiveActivityContent, LiveActivityRegistration } from "@bob/sdlc-view";
import { isLiveActivityApp } from "@bob/sdlc-view";

/** What the controller needs from the native module (modules/bob-live-activity). */
export interface LiveActivityNative {
  appId(): string | null;
  isSupported(): boolean;
  activeItemIds(): string[];
  tokens(): Record<string, string>;
  start(itemId: string, state: LiveActivityContent): Promise<string>;
  update(itemId: string, state: LiveActivityContent): Promise<void>;
  end(itemId: string): Promise<void>;
  onPushToken(listener: (event: { itemId: string; token: string }) => void): { remove(): void } | null;
  onEnded(listener: (event: { itemId: string }) => void): { remove(): void } | null;
}

/** The item's activity content from the app's view, or null when the view does not hold it. */
export function contentFor(view: EdgeView, itemId: string): LiveActivityContent | null {
  const item = view.items[itemId];
  return item ? liveActivityContent(item, view.plans[item.planId]) : null;
}

export interface LiveActivityController {
  readonly supported: boolean;
  /** Items with a running activity. */
  following(): ReadonlySet<string>;
  follow(itemId: string, content: LiveActivityContent): Promise<void>;
  stop(itemId: string): Promise<void>;
  /** The app's view changed: refresh followed items' activities from it (unchanged content is skipped). */
  viewChanged(view: EdgeView): void;
  subscribe(listener: () => void): () => void;
}

export function createLiveActivityController(
  native: LiveActivityNative,
  register: (registration: LiveActivityRegistration) => void,
): LiveActivityController {
  const rawApp = native.appId();
  const app: LiveActivityApp | undefined = isLiveActivityApp(rawApp) ? rawApp : undefined;
  const supported = native.isSupported();
  const following = new Set<string>(supported ? native.activeItemIds() : []);
  const lastContent = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const l of listeners) l(); };
  const send = (itemId: string, token: string | null) =>
    register({ type: "liveActivity", itemId, token, ...(app ? { app } : {}) });

  native.onPushToken(({ itemId, token }) => { if (following.has(itemId)) send(itemId, token); });
  native.onEnded(({ itemId }) => {
    if (!following.delete(itemId)) return;
    lastContent.delete(itemId);
    send(itemId, null);
    changed();
  });
  // Tokens that arrived before these listeners (a reload while following).
  for (const [itemId, token] of Object.entries(native.tokens())) if (following.has(itemId)) send(itemId, token);

  return {
    supported,
    following: () => following,
    async follow(itemId, content) {
      if (!supported) return;
      await native.start(itemId, content);
      following.add(itemId);
      lastContent.set(itemId, JSON.stringify(content));
      changed();
    },
    async stop(itemId) {
      following.delete(itemId);
      lastContent.delete(itemId);
      changed();
      send(itemId, null);
      await native.end(itemId);
    },
    viewChanged(view) {
      for (const itemId of following) {
        const content = contentFor(view, itemId);
        if (!content) continue;
        const json = JSON.stringify(content);
        if (lastContent.get(itemId) === json) continue;
        lastContent.set(itemId, json);
        void native.update(itemId, content).catch(() => undefined);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
