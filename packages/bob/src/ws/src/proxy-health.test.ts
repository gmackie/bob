import { describe, expect, it } from "vitest";

import {
  deriveProviderStatusFromProxy,
  foldProxyAccounts,
  maskAccountLabel,
  summarizeProxyUsage,
  type ManagementAuthFile,
} from "./proxy-health";

// Shapes recorded from CLIProxyAPI's management API (auth_files.go,
// cooldown_view.go, types.go). Only the fields Bob reads are modelled; the
// fold must survive anything else the proxy adds.

const now = new Date("2026-09-20T12:00:00.000Z");

function file(over: Partial<ManagementAuthFile>): ManagementAuthFile {
  return {
    id: "claude-7f66dfac",
    name: "claude-7f66dfac-abcdef.json",
    provider: "claude",
    type: "claude",
    status: "active",
    disabled: false,
    unavailable: false,
    email: "graham.mackie@example.com",
    success: 120,
    failed: 3,
    cooldowns: null,
    last_refresh: "2026-09-20T11:00:00.000Z",
    recent_requests: [
      { time: "2026-09-20T11:00:00Z", success: 40, failed: 1 },
      { time: "2026-09-19T11:00:00Z", success: 80, failed: 2 },
    ],
    ...over,
  };
}

describe("maskAccountLabel", () => {
  it("keeps enough to tell accounts apart and never the address itself", () => {
    expect(maskAccountLabel("graham.mackie@example.com")).toBe("g…@example.com");
    expect(maskAccountLabel("a@b.io")).toBe("a…@b.io");
  });

  it("falls back to the file id when there is no email", () => {
    expect(maskAccountLabel(undefined, "claude-7f66dfac")).toBe("claude-7f66dfac");
    expect(maskAccountLabel("", "kimi-1234")).toBe("kimi-1234");
  });
});

describe("foldProxyAccounts", () => {
  it("maps a healthy account and redacts the email", () => {
    const [account] = foldProxyAccounts([file({})], now);
    expect(account).toEqual({
      id: "claude-7f66dfac",
      provider: "claude",
      label: "g…@example.com",
      status: "ready",
      lastRefreshAt: "2026-09-20T11:00:00.000Z",
      requests24h: { success: 40, failed: 1 },
      ref: { name: "claude-7f66dfac-abcdef.json" },
    });
    expect(JSON.stringify(account)).not.toContain("graham");
  });

  it("reports an active cooldown with when it lifts", () => {
    const [account] = foldProxyAccounts(
      [
        file({
          cooldowns: [
            { scope: "model", reason: "rate_limited", retry_at: "2026-09-20T14:00:00.000Z", remaining_seconds: 7200 },
          ],
        }),
      ],
      now,
    );
    expect(account).toMatchObject({ status: "cooldown", cooldownUntil: "2026-09-20T14:00:00.000Z", cooldownReason: "rate_limited" });
  });

  it("ignores a cooldown that has already lifted", () => {
    const [account] = foldProxyAccounts(
      [file({ cooldowns: [{ scope: "model", reason: "x", retry_at: "2026-09-20T11:59:00.000Z", remaining_seconds: 0 }] })],
      now,
    );
    expect(account!.status).toBe("ready");
  });

  it("distinguishes disabled from errored accounts", () => {
    const folded = foldProxyAccounts(
      [
        file({ id: "a", disabled: true }),
        file({ id: "b", status: "error", status_message: "refresh failed: token expired" }),
        file({ id: "c", unavailable: true }),
      ],
      now,
    );
    expect(folded.map((a) => [a.id, a.status])).toEqual([
      ["a", "disabled"],
      ["b", "error"],
      ["c", "error"],
    ]);
    expect(folded[1]!.detail).toBe("refresh failed: token expired");
  });

  it("maps provider aliases onto Bob's provider ids", () => {
    const folded = foldProxyAccounts(
      [file({ id: "x", provider: "codex", type: "codex" }), file({ id: "y", provider: "xai", type: "xai" }), file({ id: "z", provider: "kimi" })],
      now,
    );
    expect(folded.map((a) => a.provider)).toEqual(["codex", "grok", "kimi"]);
  });

  it("sums only the last 24 hours of request buckets", () => {
    const [account] = foldProxyAccounts(
      [
        file({
          recent_requests: [
            { time: "2026-09-20T11:30:00Z", success: 5, failed: 0 },
            { time: "2026-09-19T12:30:00Z", success: 7, failed: 1 },
            { time: "2026-09-19T11:30:00Z", success: 100, failed: 100 },
          ],
        }),
      ],
      now,
    );
    expect(account!.requests24h).toEqual({ success: 12, failed: 1 });
  });

  it("carries the management handles the control plane needs to act on an account", () => {
    // PATCH /auth-files/status and POST /auth-files/refresh address an auth by
    // file name or auth_index, not by id. Both ride along, and neither is a secret.
    const [account] = foldProxyAccounts([file({ name: "claude-7f66dfac-abcdef.json", auth_index: "idx-7" } as never)], now);
    expect(account!.ref).toEqual({ name: "claude-7f66dfac-abcdef.json", authIndex: "idx-7" });
  });

  it("survives a malformed entry rather than dropping the whole snapshot", () => {
    const folded = foldProxyAccounts([file({}), { garbage: true } as unknown as ManagementAuthFile], now);
    expect(folded).toHaveLength(1);
  });
});

describe("deriveProviderStatusFromProxy", () => {
  const accounts = (statuses: Array<"ready" | "cooldown" | "disabled" | "error">) =>
    statuses.map((status, i) => ({
      id: `a${i}`,
      provider: "claude" as const,
      label: "x",
      status,
      requests24h: { success: 0, failed: 0 },
    }));

  it("is ready when any account for the provider is ready", () => {
    expect(deriveProviderStatusFromProxy("claude", accounts(["cooldown", "ready"]))).toBe("ready");
  });

  it("is rate_limited when every account is cooling down", () => {
    expect(deriveProviderStatusFromProxy("claude", accounts(["cooldown", "cooldown"]))).toBe("rate_limited");
  });

  it("is unauthenticated when no account can serve", () => {
    expect(deriveProviderStatusFromProxy("claude", accounts(["disabled", "error"]))).toBe("unauthenticated");
    expect(deriveProviderStatusFromProxy("claude", [])).toBe("unauthenticated");
  });

  it("only looks at the provider asked about", () => {
    const mixed = [...accounts(["ready"]), { ...accounts(["disabled"])[0]!, id: "o", provider: "codex" as const }];
    expect(deriveProviderStatusFromProxy("codex", mixed)).toBe("unauthenticated");
    expect(deriveProviderStatusFromProxy("claude", mixed)).toBe("ready");
  });
});

describe("summarizeProxyUsage", () => {
  it("totals requests per provider over 24h", () => {
    const folded = foldProxyAccounts(
      [file({ id: "a" }), file({ id: "b", provider: "codex", type: "codex" }), file({ id: "c" })],
      now,
    );
    expect(summarizeProxyUsage(folded)).toEqual({
      total: { success: 120, failed: 3 },
      byProvider: { claude: { success: 80, failed: 2 }, codex: { success: 40, failed: 1 } },
    });
  });
});
