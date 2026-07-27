/**
 * Canonical provider/adapter registry — the single source of truth for which
 * agent providers exist, what they're called, and how their many id spellings
 * normalize.
 *
 * Before this, the provider list was hand-redefined in ~6 places
 * (utils/platform.ts, dispatch-plan, agent-launcher, work-pipeline-model,
 * provider-runs-model, autoDrain) that had already drifted apart — grok/cursor
 * were missing from the dispatch picker, and "cursor" vs "cursor-agent" was
 * reconciled by ad-hoc `.includes()` matching. Everything that needs to render
 * a picker or normalize an agentType should read from here.
 */

export interface ProviderDef {
  /** Canonical agentType string written to the backend when selected. */
  id: string;
  /** Display name. */
  label: string;
  /** Emoji glyph. */
  icon: string;
  /** Alternate id spellings that normalize to this provider (e.g. backend
   *  rotation uses "cursor", the ACP adapter is "cursor-acp"). */
  aliases: string[];
  /** True = metered API quota (Codex, Cursor); false = subscription (Claude, Grok). */
  metered: boolean;
  /** Part of the auto-drain rotation + shown as a capacity card. */
  rotation: boolean;
  /** Offered in the task launch / dispatch pickers. */
  launchable: boolean;
  /** Available on the mobile client (no PTY — chat/voice only). */
  mobile: boolean;
  /** Voice/chat agent rather than a code agent — excluded from worktree launch. */
  voice?: boolean;
}

/**
 * Ordered so rotation providers lead (matching the capacity-card order:
 * claude, codex, grok, cursor), then the remaining launchable agents.
 */
export const PROVIDERS: ProviderDef[] = [
  { id: "claude", label: "Claude", icon: "🤖", aliases: ["claude-code", "claude-acp"], metered: false, rotation: true, launchable: true, mobile: false },
  { id: "codex", label: "Codex", icon: "📝", aliases: [], metered: true, rotation: true, launchable: true, mobile: false },
  { id: "grok", label: "Grok", icon: "⚡", aliases: ["grok-build"], metered: false, rotation: true, launchable: true, mobile: false },
  { id: "cursor-agent", label: "Cursor", icon: "🖱️", aliases: ["cursor", "cursor-acp"], metered: true, rotation: true, launchable: true, mobile: false },
  { id: "gemini", label: "Gemini", icon: "✨", aliases: [], metered: true, rotation: false, launchable: true, mobile: false },
  { id: "opencode", label: "OpenCode", icon: "💻", aliases: [], metered: false, rotation: false, launchable: true, mobile: true },
  { id: "kiro", label: "Kiro", icon: "🔮", aliases: [], metered: true, rotation: false, launchable: true, mobile: false },
  { id: "elevenlabs", label: "ElevenLabs Voice", icon: "🎤", aliases: [], metered: false, rotation: false, launchable: true, mobile: true, voice: true },
];

const BY_ID = new Map<string, ProviderDef>();
for (const p of PROVIDERS) {
  BY_ID.set(p.id, p);
  for (const a of p.aliases) BY_ID.set(a, p);
}

/** Look up a provider by canonical id or alias (exact, case-insensitive). */
export function getProvider(id: string | null | undefined): ProviderDef | undefined {
  if (!id) return undefined;
  return BY_ID.get(id.toLowerCase());
}

/**
 * Normalize any agentType spelling to its canonical provider id. Falls back to
 * a fuzzy substring match (so "claude-3-5" → "claude", "cursor-agent-v2" →
 * "cursor-agent"), then to the lowercased input unchanged.
 */
export function normalizeProviderId(agentType: string | null | undefined): string {
  if (!agentType) return "";
  const lower = agentType.toLowerCase();
  const exact = BY_ID.get(lower);
  if (exact) return exact.id;
  for (const p of PROVIDERS) {
    if (lower.includes(p.id) || p.aliases.some((a) => lower.includes(a))) return p.id;
  }
  return lower;
}

/** Display label for an agentType (canonical or alias), falling back to the raw value. */
export function getProviderLabel(agentType: string | null | undefined): string {
  return getProvider(agentType)?.label ?? getProvider(normalizeProviderId(agentType))?.label ?? (agentType ?? "Unknown");
}

/** Providers offered in launch/dispatch pickers, optionally filtered for mobile. */
export function getLaunchableProviders(opts?: { mobile?: boolean }): ProviderDef[] {
  const list = PROVIDERS.filter((p) => p.launchable);
  return opts?.mobile ? list.filter((p) => p.mobile) : list;
}

/** The rotation/capacity providers, in card order. */
export function getRotationProviders(): ProviderDef[] {
  return PROVIDERS.filter((p) => p.rotation);
}

/** Code agents that can run in a worktree (launchable, non-voice). */
export function getWorktreeProviders(): ProviderDef[] {
  return PROVIDERS.filter((p) => p.launchable && !p.voice);
}
