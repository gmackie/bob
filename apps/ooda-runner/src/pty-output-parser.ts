/**
 * Parse and clean PTY output from Codex/Claude CLI.
 *
 * Strategy: accumulate all stdout, then extract the final agent response
 * after the session completes. The raw PTY stream is too fragmented
 * (ANSI codes split across chunks) for per-chunk filtering.
 */

/** Strip ANSI escape codes and carriage returns */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1B\[/g, "") // partial escapes at chunk boundaries
    .replace(/\r/g, "");
}

/**
 * Extract the meaningful agent response from accumulated PTY output.
 * Call this once when the session ends, on the full concatenated stdout.
 */
export function extractAgentResponse(fullOutput: string): string {
  const cleaned = stripAnsi(fullOutput);
  const lines = cleaned.split("\n");

  // Claude's non-interactive streaming transport emits one JSON object per
  // line and puts the canonical final answer in the terminal `result` event.
  // Read that event before applying the legacy PTY marker heuristics; otherwise
  // the whole protocol transcript becomes the assistant's visible message.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; result?: unknown };
      if (
        event.type === "result" &&
        typeof event.result === "string" &&
        event.result.trim()
      ) {
        return event.result.trim();
      }
    } catch {
      // Ordinary text (including model-authored JSON fragments) continues to
      // the established marker/fallback parser below.
    }
  }

  // Find the last "codex" or "claude" marker — everything after it is the final answer
  let lastAgentIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "codex" || trimmed === "claude") {
      lastAgentIdx = i;
      break;
    }
  }

  if (lastAgentIdx >= 0) {
    // Extract everything after the last agent marker
    const answer = lines
      .slice(lastAgentIdx + 1)
      .join("\n")
      .trim();

    // Filter out trailing noise (token counts, etc.)
    return answer
      .replace(/\ntokens used\n\d[\d,]*\s*$/s, "")
      .trim();
  }

  // Fallback: no agent marker found, return cleaned output minus obvious noise
  return cleaned
    .replace(/^OpenAI Codex v[\s\S]*?--------\n/m, "")
    .replace(/\ntokens used\n\d[\d,]*\s*$/s, "")
    .trim();
}

/**
 * Quick per-chunk filter for streaming: strip ANSI and skip
 * obviously empty chunks. For display, the full parsing happens
 * via extractAgentResponse when the session completes.
 */
export function parsePtyChunk(raw: string): string {
  return stripAnsi(raw);
}

/**
 * Check if a chunk has any non-whitespace content after ANSI stripping.
 */
export function hasContent(raw: string): boolean {
  return stripAnsi(raw).trim().length > 0;
}
