import type * as ExpoHaptics from "expo-haptics";
import type { Haptic } from "@bob/arcade";

// Arcade haptics (BOB-92). Unlike ~/lib/haptics (iPad interaction taps), these are for
// the phone: iPads have no Taptic Engine, so on iPad every call is a silent no-op.
type HapticsModule = typeof ExpoHaptics;
let Haptics: HapticsModule | null = null;
try {
  // A synchronous require inside try/catch, as in ~/lib/haptics: the native module may be absent.
  Haptics = require("expo-haptics") as HapticsModule;
} catch {
  // Native module not available
}

export function playHaptic(haptic: Haptic): void {
  if (!Haptics || !haptic) return;
  const H = Haptics;
  switch (haptic) {
    case "success":
      void H.notificationAsync(H.NotificationFeedbackType.Success);
      return;
    case "warning":
      void H.notificationAsync(H.NotificationFeedbackType.Warning);
      return;
    case "error":
      void H.notificationAsync(H.NotificationFeedbackType.Error);
      return;
    case "light":
      void H.impactAsync(H.ImpactFeedbackStyle.Light);
      return;
  }
}
