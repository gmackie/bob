import { describe, expect, it } from "vitest";

import {
  getWorkspaceEventQueryRoot,
  shouldInvalidateForWorkspaceRealtimeMessage,
  shouldInvalidateQueryForWorkspaceEvent,
} from "../workspace-events-model";

describe("workspace events model", () => {
  it("extracts tRPC query roots from nested and flat query keys", () => {
    expect(getWorkspaceEventQueryRoot([["workItem", "list"], { workspaceId: "workspace-1" }])).toBe("workItem");
    expect(getWorkspaceEventQueryRoot(["planSession", "list"])).toBe("planSession");
    expect(getWorkspaceEventQueryRoot([["project.list"], { workspaceId: "workspace-1" }])).toBe("project");
  });

  it("invalidates shell data touched by workspace session events", () => {
    expect(shouldInvalidateQueryForWorkspaceEvent([["workItem", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["planSession", "list"]])).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("planning_collab_message")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("planning_artifact_updated")).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["project", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["agentRun", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["taskRun", "listByWorkItem"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["session", "get"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["settings", "getPreferences"]])).toBe(false);
  });

  it("invalidates execution-adjacent shell roots that change while agents run", () => {
    expect(shouldInvalidateQueryForWorkspaceEvent([["notification", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["instance", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["pullRequest", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["featureBranch", "list"]])).toBe(true);
  });

  it("invalidates planning, project sync, git, and provider setup roots", () => {
    expect(shouldInvalidateQueryForWorkspaceEvent([["planning", "listProjects"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["repository", "list"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["git", "jjLog"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["filesystem", "gitStatus"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["gitProviders", "listConnections"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["integration", "list"]])).toBe(true);
  });

  it("invalidates provider capacity and limit roots", () => {
    expect(shouldInvalidateQueryForWorkspaceEvent([["providerCapacity", "latest"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["provider", "capacity"]])).toBe(true);
    expect(shouldInvalidateQueryForWorkspaceEvent([["capacity", "limits"]])).toBe(true);
  });

  it("invalidates shell data for all workspace realtime message types", () => {
    expect(shouldInvalidateForWorkspaceRealtimeMessage("workspace_snapshot")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("host_snapshot")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("session_status_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("event")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("session_created")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("session_stopped")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("pong")).toBe(false);
  });

  it("invalidates shell data for design-plan realtime event names", () => {
    expect(shouldInvalidateForWorkspaceRealtimeMessage("session_event_appended")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("task_priority_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("queue_order_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("task_status_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("work_item_dispatched")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("planning_session_produced_drafts")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("planning_session_produced_tasks")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("project_sync_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("git_status_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("provider_capacity_changed")).toBe(true);
    expect(shouldInvalidateForWorkspaceRealtimeMessage("provider_limit_changed")).toBe(true);
  });
});
