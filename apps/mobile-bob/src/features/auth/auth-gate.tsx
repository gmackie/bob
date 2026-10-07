import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { hasSeenOnboarding } from "~/lib/storage";
import { authClient } from "~/utils/auth";
import { shouldSkipOnboardingForDevAuth } from "~/utils/dev-auth-bypass";
import {
  OnboardingScreen,
  SessionBootstrapScreen,
  SignInScreen,
} from "./screens";
import { getSessionGatePhase, startSessionRecovery } from "./session-recovery";
import { SessionRecoveryScreen } from "./session-recovery-screen";

/**
 * Session gate for the ROOT layout.
 *
 * Previously only the phone stack's index route checked the session, so on
 * iPad the tablet shell rendered fully "signed in" with no session at all
 * (and Log Out appeared to do nothing). Gating here covers both layouts:
 * no session → onboarding/sign-in; session → children (phone Stack or
 * tablet shell). signOut() flips the session to null and lands back here.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(
    shouldSkipOnboardingForDevAuth() ? false : null,
  );
  const phase = getSessionGatePhase({
    sessionPresent: Boolean(session),
    isPending,
    onboardingPending: showOnboarding === null,
    errorPresent: error !== null,
    errorStatus: error?.status ?? null,
  });

  useEffect(() => {
    if (phase !== "recovering") return;
    return startSessionRecovery({
      retry: refetch,
      afterDelay: (retry) => {
        const timer = setTimeout(retry, 5_000);
        return () => clearTimeout(timer);
      },
      onForeground: (retry) => {
        const subscription = AppState.addEventListener("change", (state) => {
          if (state === "active") retry();
        });
        return () => subscription.remove();
      },
      onConnectionRestored: (retry) => {
        let previousConnection: boolean | null = null;
        return NetInfo.addEventListener((state) => {
          const connected = state.isConnected === true;
          if (previousConnection === false && connected) retry();
          previousConnection = connected;
        });
      },
    });
  }, [phase, error, refetch]);

  useEffect(() => {
    if (shouldSkipOnboardingForDevAuth()) {
      return;
    }

    let cancelled = false;
    void hasSeenOnboarding()
      .then((seen) => {
        if (!cancelled) setShowOnboarding(!seen);
      })
      .catch(() => {
        if (!cancelled) setShowOnboarding(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading") {
    return <SessionBootstrapScreen />;
  }

  if (phase === "recovering") {
    return <SessionRecoveryScreen onRetry={refetch} />;
  }

  if (!session) {
    if (showOnboarding) {
      return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
    }
    return <SignInScreen />;
  }

  return <>{children}</>;
}
