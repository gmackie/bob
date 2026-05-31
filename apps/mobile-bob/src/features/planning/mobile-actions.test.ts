import { describe, expect, it } from "vitest";

import {
  buildMobilePlanningSessionRequest,
  getExecutionLaunchState,
  getMobilePlanningChatHref,
} from "./mobile-actions";

describe("mobile planning actions", () => {
  it("builds create and start inputs for a new mobile planning session", () => {
    const request = buildMobilePlanningSessionRequest({
      workspaceId: "workspace-1",
      projectId: "project-1",
      projectName: "Bob Mobile",
      goal: "  Improve the iPad dashboard  ",
    });

    expect(request?.createInput).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      workingDirectory: "/",
      title: "Improve the iPad dashboard",
      planningSessionType: "shape",
    });
    expect(request?.buildStartInput("session-1")).toEqual({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      projectName: "Bob Mobile",
      workingDirectory: "/",
      launchContext: {
        intent: "shape",
        notes: "Improve the iPad dashboard",
        selectedRepoSources: [],
        attachedFiles: [],
      },
    });
  });

  it("does not build a planning request without a usable goal or project", () => {
    expect(
      buildMobilePlanningSessionRequest({
        workspaceId: "workspace-1",
        projectId: "project-1",
        projectName: "Bob Mobile",
        goal: "   ",
      }),
    ).toBeNull();

    expect(
      buildMobilePlanningSessionRequest({
        workspaceId: "workspace-1",
        projectId: null,
        projectName: null,
        goal: "Plan a release",
      }),
    ).toBeNull();
  });

  it("describes when the execution start control should be available", () => {
    expect(
      getExecutionLaunchState({
        linkedSessionId: null,
        isPending: false,
      }),
    ).toEqual({
      disabled: false,
      label: "Start work",
    });

    expect(
      getExecutionLaunchState({
        linkedSessionId: "session-1",
        isPending: false,
      }),
    ).toEqual({
      disabled: true,
      label: "Work running",
    });
  });

  it("routes started planning sessions into the agent chat surface", () => {
    expect(getMobilePlanningChatHref()).toBe("/chat");
  });
});
