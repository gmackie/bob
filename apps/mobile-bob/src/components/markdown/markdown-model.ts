/**
 * Pure markdown helpers (no React Native imports) so they can be unit-tested
 * in the node vitest environment.
 */

export type MarkdownBlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "list"
  | "quote"
  | "table"
  | "other";

export interface MarkdownBlock {
  id: string;
  kind: MarkdownBlockKind;
  text: string;
}

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_RE = /^\s{0,3}>/;
const HR_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const JSON_KEY_RE = /"[^"\n]+"\s*:/g;

/**
 * Heuristic: does this text look like a raw JSON / structured dump rather than
 * prose markdown? Callers use this to route agent output away from the
 * markdown parser.
 */
export function looksLikeRawOutput(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  const first = trimmed.charAt(0);
  if (first === "{" || first === "[") {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // fall through to key-count heuristic
    }
  }

  const head = trimmed.slice(0, 400);
  const matches = head.match(JSON_KEY_RE);
  return matches !== null && matches.length >= 3;
}

function classifyBlock(lines: string[]): MarkdownBlockKind {
  const first = lines[0] ?? "";
  if (FENCE_RE.test(first)) return "code";
  if (HEADING_RE.test(first)) return "heading";
  if (QUOTE_RE.test(first)) return "quote";
  if (HR_RE.test(first)) return "other";
  if (LIST_RE.test(first)) return "list";
  if (lines.length >= 2 && lines.every((l) => l.includes("|"))) return "table";
  return "paragraph";
}

/**
 * Lightweight top-level block splitter. Splits on blank lines, but keeps
 * fenced code blocks (which may contain blank lines) as a single block.
 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const groups: string[][] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    if (fence !== null) {
      current.push(line);
      if (line.trim().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1] ?? "```";
      current.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    current.push(line);
  }
  flush();

  return groups.map((group, index) => ({
    id: `b${index}`,
    kind: classifyBlock(group),
    text: group.join("\n"),
  }));
}

/** Prefix each line with `> ` and add a trailing blank line for a reply composer. */
export function quoteBlock(text: string): string {
  const quoted = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
  return `${quoted}\n\n`;
}

const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i;

/**
 * Normalize a link href for opening. Rejects dangerous schemes, passes
 * http(s)/mailto through, and upgrades bare domains to https.
 */
export function normalizeLinkUrl(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;

  // A scheme never contains a dot before the colon in practice; treating
  // "host.tld:port" as a scheme would wrongly reject bare domains with ports.
  const schemeMatch = /^([a-z][a-z0-9+-]*):/i.exec(trimmed);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? "").toLowerCase();
    if (scheme === "http" || scheme === "https" || scheme === "mailto") {
      return trimmed;
    }
    return null;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (BARE_DOMAIN_RE.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}
