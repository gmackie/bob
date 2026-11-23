// When the one shared SDLC edge session runs (BOB-81). Screens retain it while mounted and
// it closes a short while after the last one goes; the app going to the background (or
// inactive) stops it, and coming back starts it again when a screen still uses it, or
// forces a reconnect (wake) so a socket that went half dead while asleep cannot keep a
// stale view looking live. A different account (or signing out) drops the session, so
// commands queued under one account are never resent under another.
//
// Pure (no React Native imports) so node tests drive it; use-sdlc-edge.ts wires it to
// AppState and the auth session.
import type { Session } from "./edge-session";

export type AppStateName = "active" | "background" | "inactive" | (string & {});

export interface EdgeLifecycleOptions {
  create: () => Session;
  idleCloseMs: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface EdgeLifecycle {
  /** The current session, created on first use. */
  get(): Session;
  /** A screen uses the session; call the returned function when it stops. */
  retain(): () => void;
  appStateChanged(next: AppStateName): void;
  /** The signed-in account (null: signed out). A change from a known account drops the session. */
  accountChanged(userId: string | null): void;
  /** Stops and forgets the session; the next get() creates a fresh one. */
  reset(): void;
}

export function createEdgeLifecycle(options: EdgeLifecycleOptions): EdgeLifecycle {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let session: Session | null = null;
  let users = 0;
  let idle: unknown;
  let foreground = true;
  /** Stopped because the app left the foreground: start(), not wake(), on return. */
  let paused = false;
  let generation = 0;
  let account: string | null | undefined;

  const cancelIdle = () => {
    if (idle !== undefined) clearTimer(idle);
    idle = undefined;
  };

  const get = () => {
    session ??= options.create();
    return session;
  };

  const reset = () => {
    generation++;
    cancelIdle();
    session?.stop();
    session = null;
    users = 0;
    paused = false;
  };

  return {
    get,
    retain() {
      const s = get();
      const mine = generation;
      users++;
      cancelIdle();
      if (foreground) s.start();
      else paused = true;
      let released = false;
      return () => {
        // A release after a reset belongs to the dropped session.
        if (released || mine !== generation) return;
        released = true;
        users--;
        if (users === 0) {
          idle = setTimer(() => {
            idle = undefined;
            if (users === 0 && mine === generation) s.stop();
          }, options.idleCloseMs);
        }
      };
    },
    appStateChanged(next) {
      if (next === "active") {
        if (foreground) return;
        foreground = true;
        const wasPaused = paused;
        paused = false;
        if (!session || users === 0) return;
        if (wasPaused) session.start();
        else session.wake();
        return;
      }
      if (next !== "background" && next !== "inactive") return;
      foreground = false;
      cancelIdle();
      if (!session) return;
      session.stop();
      paused = users > 0;
    },
    accountChanged(userId) {
      if (account !== undefined && account !== userId) reset();
      account = userId;
    },
    reset,
  };
}
