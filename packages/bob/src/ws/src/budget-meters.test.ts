import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseQuotaMeters, type ManagementQuota } from "./budget-meters";
import { foldProxyAccounts, type ManagementAuthFile } from "./proxy-health";

// Recorded from the production proxy (CLIProxyAPI fork 3bd9e323) on
// 2026-11-14; account identifiers replaced, signal values untouched.
const recorded = JSON.parse(
  readFileSync(new URL("./__fixtures__/auth-files-quota.2026-11-14.json", import.meta.url), "utf8"),
) as { files: ManagementAuthFile[] };
const byId = (id: string) => recorded.files.find((file) => file.id === id)!;

describe("parseQuotaMeters — recorded production signals", () => {
  it("reads Claude's weekly utilization as a percentage with its reset", () => {
    const meters = parseQuotaMeters("claude", byId("auth-0").quota);
    expect(meters).toEqual([
      {
        window: "weekly",
        windowMinutes: 10_080,
        usedPercent: 47,
        resetsAt: "2026-11-15T12:00:00.000Z",
        status: "allowed",
        observedAt: "2026-11-14T20:06:13.006Z",
      },
    ]);
  });

  it("reads Codex's primary weekly window and skips an inactive secondary window", () => {
    const meters = parseQuotaMeters("codex", byId("auth-2").quota);
    expect(meters).toEqual([
      {
        window: "weekly",
        windowMinutes: 10_080,
        usedPercent: 8,
        resetsAt: "2026-11-19T21:55:44.000Z",
        observedAt: "2026-11-14T20:05:55.055Z",
      },
    ]);
  });

  it("returns nothing for providers the proxy does not observe", () => {
    expect(parseQuotaMeters("kimi", byId("auth-4").quota)).toEqual([]);
    expect(parseQuotaMeters("grok", byId("auth-5").quota)).toEqual([]);
  });
});

describe("parseQuotaMeters — shapes not yet seen in production", () => {
  const observedAt = "2026-11-14T12:00:00Z";

  it("reads a Claude 5-hour window when the headers carry one", () => {
    const quota: ManagementQuota = {
      observed_at: observedAt,
      signals: {
        "anthropic-ratelimit-unified-5h-utilization": "0.82",
        "anthropic-ratelimit-unified-5h-reset": "1794700800",
        "anthropic-ratelimit-unified-5h-status": "allowed_warning",
      },
    };
    expect(parseQuotaMeters("claude", quota)).toEqual([
      {
        window: "5h",
        windowMinutes: 300,
        usedPercent: 82,
        resetsAt: new Date(1_794_700_800_000).toISOString(),
        status: "allowed_warning",
        observedAt: "2026-11-14T12:00:00.000Z",
      },
    ]);
  });

  it("derives a Codex reset from reset-after-seconds when reset-at is absent", () => {
    const quota: ManagementQuota = {
      observed_at: observedAt,
      signals: {
        "X-Codex-Secondary-Used-Percent": "64",
        "X-Codex-Secondary-Window-Minutes": "300",
        "X-Codex-Secondary-Reset-After-Seconds": "3600",
      },
    };
    expect(parseQuotaMeters("codex", quota)).toEqual([
      {
        window: "5h",
        windowMinutes: 300,
        usedPercent: 64,
        resetsAt: "2026-11-14T13:00:00.000Z",
        observedAt: "2026-11-14T12:00:00.000Z",
      },
    ]);
  });

  it("names an unfamiliar window by its length instead of guessing", () => {
    const quota: ManagementQuota = {
      observed_at: observedAt,
      signals: { "X-Codex-Primary-Used-Percent": "5", "X-Codex-Primary-Window-Minutes": "1440" },
    };
    expect(parseQuotaMeters("codex", quota)[0]).toMatchObject({ window: "1440m", windowMinutes: 1440 });
  });

  it("fails closed: unparseable values, a missing observation time or no quota yield no meter", () => {
    expect(parseQuotaMeters("claude", undefined)).toEqual([]);
    expect(parseQuotaMeters("claude", { signals: { "Anthropic-Ratelimit-Unified-7d-Utilization": "0.5" } })).toEqual([]);
    expect(
      parseQuotaMeters("claude", {
        observed_at: observedAt,
        signals: { "Anthropic-Ratelimit-Unified-7d-Utilization": "lots" },
      }),
    ).toEqual([]);
  });

  it("clamps utilization into 0–100", () => {
    const quota: ManagementQuota = {
      observed_at: observedAt,
      signals: { "Anthropic-Ratelimit-Unified-7d-Utilization": "1.3" },
    };
    expect(parseQuotaMeters("claude", quota)[0]?.usedPercent).toBe(100);
  });
});

describe("foldProxyAccounts carries meters", () => {
  const now = new Date("2026-11-14T20:10:00Z");

  it("attaches account-level meters and per-model meters to each account", () => {
    const accounts = foldProxyAccounts(recorded.files, now);
    const claude = accounts.find((account) => account.id === "auth-0")!;
    expect(claude.meters?.[0]).toMatchObject({ window: "weekly", usedPercent: 47 });
    expect(claude.modelMeters?.["claude-opus-5-5"]?.[0]).toMatchObject({ window: "weekly", usedPercent: 47 });
    expect(Object.keys(claude.modelMeters ?? {})).toHaveLength(5);
  });

  it("omits meters for accounts without quota signals", () => {
    const accounts = foldProxyAccounts(recorded.files, now);
    const kimi = accounts.find((account) => account.id === "auth-4")!;
    expect(kimi.meters).toBeUndefined();
    expect(kimi.modelMeters).toBeUndefined();
  });

  it("never lets an identifier from the management response onto the wire", () => {
    const wire = JSON.stringify(foldProxyAccounts(recorded.files, now));
    expect(wire).not.toMatch(/user\d@example\.com/);
    expect(wire).not.toMatch(/id_token|access_token|Organization-Id|Workspace-Id/i);
  });
});
