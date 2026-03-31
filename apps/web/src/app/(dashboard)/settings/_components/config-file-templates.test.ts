import { describe, expect, it } from "vitest";

import {
  BOB_WORKFLOW_SKILL_TEMPLATE,
  OPENCODE_CONFIG_JSON_TEMPLATE,
} from "./config-file-templates";

describe("config file starter templates", () => {
  it("includes Bob session secret broker env in the OpenCode starter config", () => {
    expect(OPENCODE_CONFIG_JSON_TEMPLATE).toContain("BOB_SECRET_BROKER_URL");
    expect(OPENCODE_CONFIG_JSON_TEMPLATE).toContain(
      "BOB_SECRET_BROKER_TOKEN",
    );
    expect(OPENCODE_CONFIG_JSON_TEMPLATE).toContain(
      "BOB_SESSION_SECRET_MANIFEST",
    );
  });

  it("includes session secret tool guidance in the Bob workflow starter skill", () => {
    expect(BOB_WORKFLOW_SKILL_TEMPLATE).toContain("list_session_secrets");
    expect(BOB_WORKFLOW_SKILL_TEMPLATE).toContain("exec_session_secret");
  });
});
