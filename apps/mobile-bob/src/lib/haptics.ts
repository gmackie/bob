import { Platform } from "react-native";

import type * as ExpoHaptics from "expo-haptics";

/**
 * Haptic feedback utilities for tablet interactions.
 * Lazy-loads expo-haptics to avoid crash if native module isn't available.
 */

type HapticsModule = typeof ExpoHaptics;
let Haptics: HapticsModule | null = null;

try {
  // This must stay a synchronous require() inside try/catch to defensively
  // handle a native module that may not be linked; see
  // use-push-notifications.ts for the fuller rationale.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
  Haptics = require("expo-haptics") as HapticsModule;
} catch {
  // Native module not available
}

const isIPad = Platform.OS === "ios" && Platform.isPad;

/** Light tap — session selection, tab changes */
export function hapticLight() {
  if (!isIPad || !Haptics) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Medium tap — approve, reject, stop actions */
export function hapticMedium() {
  if (!isIPad || !Haptics) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** Success — session connected, artifact saved */
export function hapticSuccess() {
  if (!isIPad || !Haptics) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Warning — session error, disconnect */
export function hapticWarning() {
  if (!isIPad || !Haptics) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

/** Selection changed — filter chips, inspector tabs */
export function hapticSelection() {
  if (!isIPad || !Haptics) return;
  void Haptics.selectionAsync();
}
