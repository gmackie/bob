import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** A setting change may arrive before the native initial read completes. */
export function observeReducedMotion(onChange: (enabled: boolean) => void) {
  let readInitial = true;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
    readInitial = false;
    onChange(enabled);
  });
  void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
    if (readInitial) onChange(enabled);
  });
  return () => {
    readInitial = false;
    subscription.remove();
  };
}

export function useSystemReducedMotion() {
  const atLaunch = useReducedMotion();
  const [reduced, setReduced] = useState(atLaunch);
  useEffect(() => observeReducedMotion(setReduced), []);
  return reduced;
}
