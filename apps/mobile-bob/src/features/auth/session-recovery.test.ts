import { describe, expect, it } from "vitest";

import { getSessionGatePhase, startSessionRecovery } from "./session-recovery";

describe("session recovery after a backend interruption", () => {
  it("distinguishes a failed session lookup from a confirmed signed-out session", () => {
    const state = {
      sessionPresent: false,
      isPending: false,
      onboardingPending: false,
      errorPresent: true,
      errorStatus: 503,
    };

    expect(getSessionGatePhase(state)).toBe("recovering");
    expect(
      getSessionGatePhase({ ...state, errorPresent: false, errorStatus: null }),
    ).toBe("signed-out");
    expect(getSessionGatePhase({ ...state, sessionPresent: true })).toBe(
      "authenticated",
    );
  });

  it("keeps network failures recoverable and server rejection signed out", () => {
    const state = {
      sessionPresent: false,
      isPending: false,
      onboardingPending: false,
      errorPresent: true,
      errorStatus: null,
    };

    expect(getSessionGatePhase(state)).toBe("recovering");
    expect(getSessionGatePhase({ ...state, errorStatus: 401 })).toBe(
      "signed-out",
    );
    expect(getSessionGatePhase({ ...state, errorStatus: 403 })).toBe(
      "signed-out",
    );
    expect(getSessionGatePhase({ ...state, isPending: true })).toBe("loading");
  });

  it.each(["timer", "foreground", "connection"] as const)(
    "retries once when %s fires and ignores overlapping events",
    (trigger) => {
      const callbacks: { name: string; run: () => void }[] = [];
      const disposed: string[] = [];
      let attempts = 0;
      const register = (name: string, run: () => void) => {
        callbacks.push({ name, run });
        return () => disposed.push(name);
      };
      const stop = startSessionRecovery({
        retry: () => {
          attempts += 1;
        },
        afterDelay: (run) => register("timer", run),
        onForeground: (run) => register("foreground", run),
        onConnectionRestored: (run) => register("connection", run),
      });

      callbacks.find((callback) => callback.name === trigger)?.run();
      callbacks.forEach((callback) => callback.run());
      expect(attempts).toBe(1);
      stop();
      callbacks.forEach((callback) => callback.run());
      expect(attempts).toBe(1);
      expect(disposed).toEqual(["timer", "foreground", "connection"]);
    },
  );

  it("cancels pending recovery when the session resolves or the gate unmounts", () => {
    const callbacks: (() => void)[] = [];
    let attempts = 0;
    const subscribe = (run: () => void) => {
      callbacks.push(run);
      return () => undefined;
    };
    const stop = startSessionRecovery({
      retry: () => {
        attempts += 1;
      },
      afterDelay: subscribe,
      onForeground: subscribe,
      onConnectionRestored: subscribe,
    });

    stop();
    callbacks.forEach((run) => run());
    expect(attempts).toBe(0);
  });
});
