import { describe, expect, it } from "vitest";

import {
  buildMobileSettingsActions,
  buildMobileSettingsDeviceSummary,
  buildMobileSettingsProviderRows,
  buildWorkspaceSettingRows,
} from "./settings-model";

describe("mobile settings model", () => {
  it("includes workspace, account, provider, app, device, and logout actions", () => {
    expect(buildMobileSettingsActions().map((action) => action.label)).toEqual([
      "Change Workspace",
      "Account Settings",
      "Provider Settings",
      "App Settings",
      "Device Settings",
      "Log Out",
    ]);
  });

  it("gives each section action a concrete settings target", () => {
    expect(
      buildMobileSettingsActions().map((action) => [
        action.key,
        action.kind === "section" ? action.targetSection : "logout",
      ]),
    ).toEqual([
      ["workspace", "workspace"],
      ["account", "account"],
      ["providers", "providers"],
      ["app", "app"],
      ["device", "device"],
      ["logout", "logout"],
    ]);
  });

  it("exposes Codex and Cursor provider settings rows", () => {
    expect(buildMobileSettingsProviderRows()).toEqual([
      {
        key: "codex",
        label: "Codex",
        description: "Open Codex usage, limits, active sessions, and recent outcomes.",
        href: "/providers/codex",
      },
      {
        key: "cursor",
        label: "Cursor",
        description: "Open Cursor usage, limits, active sessions, and recent outcomes.",
        href: "/providers/cursor",
      },
    ]);
  });

  it("summarizes device auth and API key state for settings", () => {
    expect(buildMobileSettingsDeviceSummary({ apiKeyCount: 1 })).toEqual({
      title: "Device",
      primaryLabel: "1 API key configured",
      detailLabel: "Device auth is tied to the current signed-in session.",
    });
    expect(buildMobileSettingsDeviceSummary({ apiKeyCount: 3 }).primaryLabel).toBe(
      "3 API keys configured",
    );
  });

  it("marks the selected workspace and falls back to the first workspace", () => {
    const rows = buildWorkspaceSettingRows({
      selectedWorkspaceId: null,
      memberships: [
        { workspace: { id: "workspace-1", name: "Acme", slug: "acme" } },
        { workspace: { id: "workspace-2", name: "Ops", slug: "ops" } },
      ],
    });

    expect(rows).toEqual([
      {
        id: "workspace-1",
        name: "Acme",
        slug: "acme",
        isSelected: true,
      },
      {
        id: "workspace-2",
        name: "Ops",
        slug: "ops",
        isSelected: false,
      },
    ]);
  });

  it("preserves an explicit selected workspace when it exists", () => {
    const rows = buildWorkspaceSettingRows({
      selectedWorkspaceId: "workspace-2",
      memberships: [
        { workspace: { id: "workspace-1", name: "Acme", slug: "acme" } },
        { workspace: { id: "workspace-2", name: "Ops", slug: "ops" } },
      ],
    });

    expect(rows.map((row) => [row.id, row.isSelected])).toEqual([
      ["workspace-1", false],
      ["workspace-2", true],
    ]);
  });
});
