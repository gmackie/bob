import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditSecretAccess,
  clearSecretAccessEvents,
  getRecentSecretAccessEvents,
} from "../secretAccessAudit.js";

describe("secretAccessAudit", () => {
  afterEach(() => {
    clearSecretAccessEvents();
    vi.restoreAllMocks();
  });

  it("records events in the ring buffer without plaintext", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    auditSecretAccess({
      resource: "session_secret",
      action: "decrypt",
      userId: "user-1",
      sessionId: "sess-1",
      resourceId: "sec-1",
      success: true,
    });

    const events = getRecentSecretAccessEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      resource: "session_secret",
      action: "decrypt",
      userId: "user-1",
      success: true,
    });
    expect(events[0]).not.toHaveProperty("value");
    expect(events[0]).not.toHaveProperty("plaintext");

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("[secret-access-audit]");
    expect(line).not.toMatch(/ghp_|password|secret-value/i);
  });

  it("caps the ring buffer", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (let i = 0; i < 520; i++) {
      auditSecretAccess({
        resource: "browser_cookie",
        action: "decrypt_for_session",
        success: true,
        count: i,
      });
    }
    expect(getRecentSecretAccessEvents().length).toBeLessThanOrEqual(500);
  });
});
