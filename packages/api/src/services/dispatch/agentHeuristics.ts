export function suggestAgent(draft: {
  kind: string;
  title: string;
  description: string | null;
}): string {
  // Epics and design tasks → claude (best reasoning)
  if (draft.kind === "epic") return "claude";

  // Test tasks → codex (good at test generation)
  const t = draft.title.toLowerCase();
  const d = (draft.description ?? "").toLowerCase();
  if (
    t.includes("test") ||
    t.includes("e2e") ||
    d.includes("test coverage") ||
    d.includes("write tests")
  ) {
    return "codex";
  }

  // Default implementation task execution → smol-agent
  return "smol-agent";
}
