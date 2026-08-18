import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { getAuthenticatedHomeHref } from "~/features/chat/navigation";

// Session gating (bootstrap/onboarding/sign-in) lives in the root layout's
// AuthGate — by the time any route renders, a session exists. This route
// only forwards to the device-appropriate home.
export default function Index() {
  return (
    <Redirect
      href={getAuthenticatedHomeHref({
        isTablet: Platform.OS === "ios" && Platform.isPad,
      })}
    />
  );
}
