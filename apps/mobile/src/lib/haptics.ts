import { Platform } from "react-native";

/**
 * Haptic feedback utilities for tablet interactions.
 * Lazy-loads expo-haptics to avoid crash if native module isn't available.
 */

type HapticsModule = typeof import("expo-haptics");
let Haptics: HapticsModule | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Haptics = require("expo-haptics");
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
