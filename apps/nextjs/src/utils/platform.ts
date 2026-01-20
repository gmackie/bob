/**
 * Platform detection utilities
 * Used to gate features between web and mobile platforms
 */

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
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
}

/**
 * Get available agent types based on platform
 * Web: all agents including PTY-based
 * Mobile: chat and voice only (no PTY)
 */
export function getAvailableAgentTypes(): Array<{ value: string; label: string; icon: string }> {
  const allAgents = [
    { value: "opencode", label: "OpenCode", icon: "💻" },
    { value: "elevenlabs", label: "ElevenLabs Voice", icon: "🎤" },
    { value: "claude", label: "Claude", icon: "🤖" },
    { value: "codex", label: "Codex", icon: "📝" },
    { value: "gemini", label: "Gemini", icon: "✨" },
    { value: "kiro", label: "Kiro", icon: "🔮" },
    { value: "cursor-agent", label: "Cursor Agent", icon: "🖱️" },
  ] as const;

  if (isMobilePlatform()) {
    // Mobile: only chat and voice agents
    return allAgents.filter(
      (agent) => agent.value === "opencode" || agent.value === "elevenlabs"
    );
  }

  // Web: all agents
  return allAgents;
}
