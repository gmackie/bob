/**
 * Platform detection utilities
 * Used to gate features between web and mobile platforms
 */

import { getLaunchableProviders } from "~/lib/providers";

/**
 * Check if the current platform is mobile
 * Uses user agent detection (can be enhanced with device detection libraries)
 */
export function isMobilePlatform(): boolean {
  if (typeof window === "undefined") {
    // Server-side: check environment variable or default to false
    return process.env.PLATFORM === "mobile" || false;
  }

  // Client-side: check user agent
  const ua = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
    ua,
  );
}

/**
 * Get available agent types based on platform
 * Web: all agents including PTY-based
 * Mobile: chat and voice only (no PTY)
 */
export function getAvailableAgentTypes(): Array<{
  value: string;
  label: string;
  icon: string;
}> {
  // Sourced from the canonical provider registry (single source of truth).
  // Web: all launchable agents. Mobile: chat/voice only (registry `mobile` flag).
  return getLaunchableProviders({ mobile: isMobilePlatform() }).map((p) => ({
    value: p.id,
    label: p.label,
    icon: p.icon,
  }));
}
