/**
 * Per-provider interactive login, driven from the browser.
 *
 * Commands verified against the installed CLIs on 2026-08-29:
 *
 *   claude auth login              prints a URL, then waits for a pasted code
 *   codex login --device-auth      device-code flow
 *   grok login --device-auth       device-code flow (alias: --device-code)
 *   cursor-agent login             needs NO_OPEN_BROWSER on a headless host
 *
 * Matching PTY output with regexes is the most fragile part of this feature: a
 * CLI can reword its prompt in any release and every matcher here goes stale.
 * So the session that uses these drivers FAILS OPEN — when no URL is matched it
 * streams the sanitized PTY tail to the operator instead of dead-ending. A
 * stale matcher must degrade to a slightly worse UI, never to "SSH in anyway",
 * which is the exact outcome this feature exists to remove.
 */

import type { ProviderId } from "./contract.js";

/** PTY output is full of colour codes and cursor moves; strip before matching. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-?]*[ -/]*[@-~]/g, "").replace(/\][^]*/g, "");
}

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/;

/**
 * First URL in the output, de-ANSI'd and stripped of wrapping punctuation.
 * Deliberately generic: any provider that prints a link is supported, including
 * ones added after this was written.
 */
export function matchAnyUrl(text: string): string | null {
  const match = URL_PATTERN.exec(stripAnsi(text));
  if (!match) return null;
  return match[0].replace(/[).,;:\]]+$/, "");
}

/**
 * A one-time code the CLI wants the operator to enter in their BROWSER — as
 * distinct from a code we collect and write back to stdin. codex prints
 * "Enter this one-time code" followed by e.g. JVFQ-KZQ11; without surfacing it
 * the operator cannot finish the flow.
 */
const DISPLAY_CODE = /(?:one-?time code|enter this code|user[_ ]code)\D{0,40}\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/i;
const BARE_CODE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/;

export function matchDisplayCode(text: string): string | null {
  const clean = stripAnsi(text);
  const labelled = DISPLAY_CODE.exec(clean);
  if (labelled?.[1]) return labelled[1];
  // grok puts the code in the URL query instead of printing it separately.
  const fromUrl = /[?&]user_code=([A-Za-z0-9-]+)/.exec(clean);
  if (fromUrl?.[1]) return fromUrl[1];
  const bare = BARE_CODE.exec(clean);
  return bare?.[1] ?? null;
}

const CODE_PROMPT = /(paste|enter|type).{0,40}\bcode\b|code\s*[:>]\s*$|verification code/i;
const SUCCESS = /(login|sign[- ]?in|authentication)\s*(was\s*)?(successful|succeeded|complete)|successfully (signed|logged) in|you are now logged in|welcome back/i;
const FAILURE = /\b(error|failed|failure|denied|expired|timed out|invalid)\b/i;

export interface AuthDriver {
  provider: ProviderId;
  command: string;
  args: string[];
  env?: Record<string, string>;
  matchUrl(text: string): string | null;
  matchCodePrompt(text: string): boolean;
  matchSuccess(text: string): boolean;
  /** A code the operator must READ and enter in their browser (not submit here). */
  matchDisplayCode(text: string): string | null;
  /** Returns the failure reason, or null when the output is not a failure. */
  matchFailure(text: string): string | null;
}

function makeDriver(
  provider: ProviderId,
  command: string,
  args: string[],
  env?: Record<string, string>,
): AuthDriver {
  return {
    provider,
    command,
    args,
    env,
    matchUrl: matchAnyUrl,
    matchCodePrompt: (text) => CODE_PROMPT.test(stripAnsi(text)),
    matchSuccess: (text) => SUCCESS.test(stripAnsi(text)),
    matchDisplayCode,
    matchFailure: (text) => {
      // Strip URLs first: `?next=/error-page` in a verification link is not a
      // failure, and reading it as one would abort a working login.
      const clean = stripAnsi(text).replace(/https?:\/\/\S+/g, "");
      const match = FAILURE.exec(clean);
      if (!match) return null;
      return clean.trim().split("\n").filter(Boolean).pop()?.trim() ?? match[0];
    },
  };
}

export const authDrivers: Record<ProviderId, AuthDriver> = {
  claude: makeDriver("claude", "claude", ["auth", "login"]),
  codex: makeDriver("codex", "codex", ["login", "--device-auth"]),
  grok: makeDriver("grok", "grok", ["login", "--device-auth"]),
  "cursor-agent": makeDriver("cursor-agent", "cursor-agent", ["login"], {
    NO_OPEN_BROWSER: "1",
  }),
};

export function getAuthDriver(provider: ProviderId): AuthDriver {
  return authDrivers[provider];
}
