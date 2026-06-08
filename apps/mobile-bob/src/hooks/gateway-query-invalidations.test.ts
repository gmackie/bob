import { describe, expect, it } from "vitest";

import {
  getGatewayEventQueryRoot,
  shouldInvalidateGatewayRealtimeMessage,
  shouldInvalidateGatewayEventQuery,
} from "./gateway-query-invalidations";

describe("gateway query invalidations", () => {
  it("extracts tRPC query roots from nested and dotted query keys", () => {
    expect(getGatewayEventQueryRoot([["workItem", "list"], { workspaceId: "workspace-1" }])).toBe("workItem");
    expect(getGatewayEventQueryRoot([["planning.listProjects"], { workspaceId: "workspace-1" }])).toBe("planning");
    expect(getGatewayEventQueryRoot(["project", "list"])).toBe("project");
  });

  it("invalidates mobile shell queries touched by live gateway events", () => {
    expect(shouldInvalidateGatewayEventQuery([["workItem", "list"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["workItems", "reorderQueue"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["planSession", "list"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["planning", "listProjects"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["project", "list"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["agentRun", "list"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["taskRun", "listByWorkItem"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["session", "getEvents"]])).toBe(true);
  });

  it("invalidates project sync, git status, and provider setup roots", () => {
    expect(shouldInvalidateGatewayEventQuery([["repository", "list"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["git", "jjLog"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["filesystem", "gitStatus"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["gitProviders", "listConnections"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["integration", "list"]])).toBe(true);
  });

  it("invalidates provider capacity and limit roots", () => {
    expect(shouldInvalidateGatewayEventQuery([["providerCapacity", "latest"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["provider", "capacity"]])).toBe(true);
    expect(shouldInvalidateGatewayEventQuery([["capacity", "limits"]])).toBe(true);
  });

  it("invalidates mobile shell data for design-plan realtime message types", () => {
    expect(shouldInvalidateGatewayRealtimeMessage("session_created")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("session_status_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("session_event_appended")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("task_priority_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("queue_order_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("task_status_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("work_item_dispatched")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("planning_session_produced_drafts")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("planning_session_produced_tasks")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("project_sync_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("git_status_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("provider_capacity_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("provider_limit_changed")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("workspace_snapshot")).toBe(true);
    expect(shouldInvalidateGatewayRealtimeMessage("pong")).toBe(false);
  });

  it("does not invalidate unrelated static app settings", () => {
    expect(shouldInvalidateGatewayEventQuery([["settings", "getPreferences"]])).toBe(false);
    expect(shouldInvalidateGatewayEventQuery([["auth", "getSession"]])).toBe(false);
  });
});
