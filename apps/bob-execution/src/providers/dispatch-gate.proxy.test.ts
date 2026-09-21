import { describe, expect, it } from "vitest";

import { decideDispatch } from "./dispatch-gate.js";

describe("decideDispatch — inference proxy", () => {
  it("treats an unreachable proxy as confirmed dead with its own remedy", () => {
    // No dispatch can succeed while the transport is down, but the fix is
    // "check the proxy", not "install" (the CLI is present) and not "sign in"
    // (the accounts are fine). Offering either would loop the operator.
    const decision = decideDispatch(
      ["claude", "codex"],
      [
        { name: "claude", status: "proxy_unreachable", detail: "connect ECONNREFUSED" },
        { name: "codex", status: "proxy_unreachable" },
      ],
    );
    expect(decision.paused).toBe(true);
    expect(decision.blocked.map((b) => b.remedy)).toEqual(["check_proxy", "check_proxy"]);
  });

  it("still dispatches to a provider that is not behind the proxy", () => {
    const decision = decideDispatch(
      ["claude", "grok"],
      [
        { name: "claude", status: "proxy_unreachable" },
        { name: "grok", status: "ready" },
      ],
    );
    expect(decision).toMatchObject({ agent: "grok", paused: false });
    expect(decision.blocked).toEqual([
      { agent: "claude", status: "proxy_unreachable", detail: undefined, remedy: "check_proxy" },
    ]);
  });
});
