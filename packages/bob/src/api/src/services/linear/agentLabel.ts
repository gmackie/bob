/**
 * Per-card agent override via tracker labels.
 *
 * A Kanbanger/Linear label `agent:<name>` (also `agent/<name>`, `agent=<name>`,
 * case-insensitive) pins which agent auto-drain uses for that card, so a human
 * can steer a specific task to e.g. codex without touching Bob. Only known
 * agent names count; anything else is ignored. First match wins.
 */
export const KNOWN_AGENTS = ["claude", "codex", "grok", "cursor", "kiro"] as const;
export type KnownAgent = (typeof KNOWN_AGENTS)[number];

const LABEL = /^agent\s*[:/=]\s*([a-z0-9_-]+)$/i;

export function agentOverrideFromLabels(labelNames: readonly string[]): KnownAgent | null {
  for (const raw of labelNames) {
    const m = LABEL.exec(raw.trim());
    const name = m?.[1]?.toLowerCase();
    if (!name) continue;
    if ((KNOWN_AGENTS as readonly string[]).includes(name)) return name as KnownAgent;
  }
  return null;
}
