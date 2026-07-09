import { describe, expect, it } from "vitest";

import { AgentRpc } from "../groups/agent.js";
import { AuthRpc } from "../groups/auth.js";
import { ProjectsRpc } from "../groups/projects.js";
import { SecretsRpc } from "../groups/secrets.js";
import { SettingsRpc } from "../groups/settings.js";

describe("Platform contract groups — Phase 7B-4B verification", () => {
  it("AgentRpc has 81 procedures", () => {
    expect(AgentRpc.requests.size).toBe(81);
  });

  it("ProjectsRpc has 56 procedures", () => {
    expect(ProjectsRpc.requests.size).toBe(58);
  });

  it("SettingsRpc has 20 procedures", () => {
    expect(SettingsRpc.requests.size).toBe(20);
  });

  it("SecretsRpc has 14 procedures", () => {
    expect(SecretsRpc.requests.size).toBe(14);
  });

  it("AuthRpc has 11 procedures", () => {
    expect(AuthRpc.requests.size).toBe(11);
  });

  it("platform total is 184 procedures", () => {
    const total =
      AgentRpc.requests.size +
      ProjectsRpc.requests.size +
      SettingsRpc.requests.size +
      SecretsRpc.requests.size +
      AuthRpc.requests.size;
    expect(total).toBe(184);
  });
});
