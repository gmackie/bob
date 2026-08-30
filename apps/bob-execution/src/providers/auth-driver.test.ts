import { describe, expect, it } from "vitest";

import { authDrivers, getAuthDriver, matchAnyUrl } from "./auth-driver.js";

describe("auth driver commands", () => {
  // Verified against the installed CLIs on 2026-08-29.
  it.each([
    ["claude", "claude", ["auth", "login"]],
    ["codex", "codex", ["login", "--device-auth"]],
    ["grok", "grok", ["login", "--device-auth"]],
    ["cursor-agent", "cursor-agent", ["login"]],
  ] as const)("%s uses the real login command", (provider, command, args) => {
    const driver = getAuthDriver(provider);
    expect(driver.command).toBe(command);
    expect(driver.args).toEqual(args);
  });

  it("stops cursor-agent from opening a browser on a headless host", () => {
    // `cursor-agent login` help: "Set NO_OPEN_BROWSER to disable browser opening."
    expect(getAuthDriver("cursor-agent").env).toMatchObject({ NO_OPEN_BROWSER: "1" });
  });

  it("covers every provider so no agent is unfixable from the UI", () => {
    expect(Object.keys(authDrivers).sort()).toEqual(
      ["claude", "codex", "cursor-agent", "grok"].sort(),
    );
  });
});

describe("matchAnyUrl", () => {
  it("finds a verification URL in noisy PTY output", () => {
    expect(
      matchAnyUrl("Open this URL to continue:\n  https://auth.x.ai/device?code=ABCD-1234\n\n> "),
    ).toBe("https://auth.x.ai/device?code=ABCD-1234");
  });

  it("strips ANSI escapes before matching — PTYs emit them constantly", () => {
    expect(matchAnyUrl("[36mhttps://example.com/device[0m")).toBe(
      "https://example.com/device",
    );
  });

  it("strips trailing punctuation the CLI wrapped around the URL", () => {
    expect(matchAnyUrl("Visit (https://example.com/device).")).toBe("https://example.com/device");
  });

  it("ignores http URLs that are not verification links", () => {
    expect(matchAnyUrl("no link here")).toBeNull();
  });

  it("returns the first URL when several appear", () => {
    expect(matchAnyUrl("https://a.example/1 and https://b.example/2")).toBe("https://a.example/1");
  });
});

describe("driver output matching", () => {
  const claude = getAuthDriver("claude");
  const grok = getAuthDriver("grok");

  it("detects a code prompt", () => {
    expect(claude.matchCodePrompt("Paste code here if prompted:")).toBe(true);
    expect(grok.matchCodePrompt("Enter the code shown in your browser: ")).toBe(true);
  });

  it("does not mistake ordinary output for a code prompt", () => {
    expect(claude.matchCodePrompt("Fetching account details...")).toBe(false);
  });

  it("detects success", () => {
    expect(claude.matchSuccess("Login successful. Welcome back!")).toBe(true);
    expect(grok.matchSuccess("Successfully signed in")).toBe(true);
  });

  it("detects failure and returns the reason", () => {
    expect(grok.matchFailure("Error: device code expired")).toMatch(/expired/i);
  });

  it("returns null when there is no failure", () => {
    expect(grok.matchFailure("waiting for authorization...")).toBeNull();
  });

  it("does not treat the word 'error' inside a URL as a failure", () => {
    expect(grok.matchFailure("https://auth.x.ai/device?next=/error-page")).toBeNull();
  });
});


// Fixtures captured from the installed CLIs on 2026-08-29. These are the real
// strings the matchers must survive, not invented ones. \x1b escapes are
// written explicitly so the fixtures stay readable in review.
const ESC = "\x1b";
const REAL_OUTPUT = {
  grok:
    "\nTo sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=SWKT-EYQC\n\n",
  codex:
    `\nWelcome to Codex [v${ESC}[90m0.151.0${ESC}[0m]\n${ESC}[90mOpenAI's command-line coding agent${ESC}[0m\n\n` +
    `Follow these steps to sign in with ChatGPT using device code authorization:\n\n` +
    `1. Open this link in your browser and sign in to your account\n   ${ESC}[94mhttps://auth.openai.com/codex/device${ESC}[0m\n\n` +
    `2. Enter this one-time code ${ESC}[90m(expires in 15 minutes)${ESC}[0m\n   ${ESC}[94mJVFQ-KZQ11${ESC}[0m\n\n`,
  claude:
    `Opening browser to sign in…\nIf the browser didn't open, visit: ${ESC}]8;;https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a${ESC}\\claude.com${ESC}]8;;${ESC}\\`,
};

describe("real CLI output (captured 2026-08-29)", () => {
  it("extracts grok's verification URL", () => {
    expect(getAuthDriver("grok").matchUrl(REAL_OUTPUT.grok)).toBe(
      "https://accounts.x.ai/oauth2/device?user_code=SWKT-EYQC",
    );
  });

  it("extracts codex's URL from behind ANSI colour codes", () => {
    expect(getAuthDriver("codex").matchUrl(REAL_OUTPUT.codex)).toBe(
      "https://auth.openai.com/codex/device",
    );
  });

  it("extracts claude's URL from inside an OSC 8 hyperlink", () => {
    // The OSC 8 introducer is ESC ] 8 ;; — stripping from the first "]" to the
    // terminator would delete the URL itself, which is the only thing the
    // operator actually needs.
    expect(getAuthDriver("claude").matchUrl(REAL_OUTPUT.claude)).toContain(
      "https://claude.com/cai/oauth/authorize",
    );
  });

  it("surfaces codex's one-time code — the flow cannot be completed without it", () => {
    expect(getAuthDriver("codex").matchDisplayCode(REAL_OUTPUT.codex)).toBe("JVFQ-KZQ11");
  });

  it("surfaces grok's code from the URL query", () => {
    expect(getAuthDriver("grok").matchDisplayCode(REAL_OUTPUT.grok)).toBe("SWKT-EYQC");
  });

  it("does not mistake any of this for a failure", () => {
    for (const [provider, text] of Object.entries(REAL_OUTPUT)) {
      expect(getAuthDriver(provider as never).matchFailure(text)).toBeNull();
    }
  });

  it("does not mistake any of this for success", () => {
    for (const [provider, text] of Object.entries(REAL_OUTPUT)) {
      expect(getAuthDriver(provider as never).matchSuccess(text)).toBe(false);
    }
  });
});
