import { describe, expect, it } from "vitest";

import {
  buildPlanningSections,
  getAgentChatHref,
  getNotificationsHref,
  getPlanningHref,
  getProjectHref,
  getTaskWorkspaceHref,
  getWorkItemHref,
  groupActiveTaskStatuses,
} from "./navigation";

describe("planning navigation", () => {
  it("builds stable planning and execution routes", () => {
    expect(getPlanningHref()).toBe("/planning");
    expect(getAgentChatHref()).toBe("/chat");
    expect(getProjectHref("project-123")).toBe("/projects/project-123");
    expect(getWorkItemHref("task-456")).toBe("/work-items/task-456");
    expect(getTaskWorkspaceHref("task-456")).toBe(
      "/work-items/task-456/workspace",
    );
    expect(getNotificationsHref()).toBe("/notifications");
  });

  it("summarizes active execution states for the mobile planning shell", () => {
    expect(
      groupActiveTaskStatuses([
        {
          id: "1",
          identifier: "APP-1",
          title: "Implement auth",
          kind: "task",
          status: "in_progress",
        },
        {
          id: "2",
          identifier: "APP-2",
          title: "Review tests",
          kind: "task",
          status: "in_review",
        },
        {
          id: "3",
          identifier: "APP-3",
          title: "Need product input",
          kind: "task",
          status: "blocked",
        },
      ]),
    ).toEqual({
      inProgress: 1,
      inReview: 1,
      blocked: 1,
    });
  });

  it("builds the merged planning sections used by the mobile shell", () => {
    expect(
      buildPlanningSections({
        workspaces: [
          {
            id: "workspace-1",
            name: "Bob Builder",
            projectCount: 2,
            activeTaskCount: 3,
          },
        ],
        projects: [
          {
            id: "project-1",
            name: "Mobile Merge",
            key: "MOB",
            activeCount: 2,
            issueCount: 4,
            taskCount: 3,
          },
        ],
        workItems: [
          {
            id: "task-1",
            identifier: "MOB-12",
            title: "Ship mobile planning shell",
            kind: "task",
            status: "in_progress",
          },
        ],
        notifications: [
          {
            id: "notification-1",
            title: "Review ready",
            body: "Task is ready for review",
            read: false,
          },
          {
            id: "notification-2",
            title: "Artifact attached",
            body: null,
            read: true,
          },
        ],
      }),
    ).toEqual({
      heroWorkspace: {
        id: "workspace-1",
        name: "Bob Builder",
        projectCount: 2,
        activeTaskCount: 3,
      },
      featuredProjects: [
        {
          id: "project-1",
          name: "Mobile Merge",
          key: "MOB",
          activeCount: 2,
          issueCount: 4,
          taskCount: 3,
        },
      ],
      recentWorkItems: [
        {
          id: "task-1",
          identifier: "MOB-12",
          title: "Ship mobile planning shell",
          kind: "task",
          status: "in_progress",
        },
      ],
      unreadNotifications: [
        {
          id: "notification-1",
          title: "Review ready",
          body: "Task is ready for review",
          read: false,
        },
      ],
      executionSummary: {
        inProgress: 1,
        inReview: 0,
        blocked: 0,
      },
    });
  });
});
