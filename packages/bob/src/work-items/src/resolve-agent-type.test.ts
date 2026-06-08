import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_TYPE, resolveAgentType } from "./resolve-agent-type";

describe("resolveAgentType", () => {
  it("prefers the work-item override over project and workspace defaults", () => {
    expect(
      resolveAgentType({
        workItemOverride: "grok",
        projectDefault: "codex",
        workspaceDefault: "claude",
      }),
    ).toBe("grok");
  });

  it("falls back to the project default when there is no work-item override", () => {
    expect(
      resolveAgentType({
        workItemOverride: null,
        projectDefault: "codex",
        workspaceDefault: "claude",
      }),
    ).toBe("codex");
  });

  it("falls back to the workspace default when there is no override or project default", () => {
    expect(
      resolveAgentType({
        workItemOverride: null,
        projectDefault: null,
        workspaceDefault: "grok",
      }),
    ).toBe("grok");
  });

  it("falls back to the hardcoded default when nothing is configured", () => {
    expect(
      resolveAgentType({
        workItemOverride: null,
        projectDefault: null,
        workspaceDefault: null,
      }),
    ).toBe(DEFAULT_AGENT_TYPE);
  });

  it("treats empty strings as unset and falls through", () => {
    expect(
      resolveAgentType({
        workItemOverride: "",
        projectDefault: "",
        workspaceDefault: "grok",
      }),
    ).toBe("grok");
  });

  it("works when fields are omitted entirely", () => {
    expect(resolveAgentType({})).toBe(DEFAULT_AGENT_TYPE);
  });
});
