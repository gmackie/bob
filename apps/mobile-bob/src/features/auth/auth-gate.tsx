import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { hasSeenOnboarding } from "~/lib/storage";
import { authClient } from "~/utils/auth";
import { shouldSkipOnboardingForDevAuth } from "~/utils/dev-auth-bypass";
import {
  OnboardingScreen,
  SessionBootstrapScreen,
  SignInScreen,
} from "./screens";

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
  const { data: session, isPending } = authClient.useSession();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(
    shouldSkipOnboardingForDevAuth() ? false : null,
  );

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

  if (isPending || showOnboarding === null) {
    return <SessionBootstrapScreen />;
  }

  if (!session) {
    if (showOnboarding) {
      return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
    }
    return <SignInScreen />;
  }

  return <>{children}</>;
}
