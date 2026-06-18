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
  groupPlanningWorkItems,
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
          {
            id: "task-2",
            identifier: "MOB-13",
            title: "Fix iPad landscape",
            kind: "task",
            status: "blocked",
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
      workPipeline: {
        active: [
          {
            id: "task-1",
            identifier: "MOB-12",
            title: "Ship mobile planning shell",
            kind: "task",
            status: "in_progress",
          },
        ],
        queued: [],
        review: [
          {
            id: "task-2",
            identifier: "MOB-13",
            title: "Fix iPad landscape",
            kind: "task",
            status: "blocked",
          },
        ],
        done: [],
      },
      recentWorkItems: [
        {
          id: "task-1",
          identifier: "MOB-12",
          title: "Ship mobile planning shell",
          kind: "task",
          status: "in_progress",
        },
        {
          id: "task-2",
          identifier: "MOB-13",
          title: "Fix iPad landscape",
          kind: "task",
          status: "blocked",
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
      primaryAction: {
        id: "notification-1",
        source: "notification",
        title: "Review ready",
        subtitle: "Task is ready for review",
        ctaLabel: "Open inbox",
        href: "/notifications",
        tone: "accent",
      },
      attentionItems: [
        {
          id: "notification-1",
          source: "notification",
          title: "Review ready",
          subtitle: "Task is ready for review",
          badge: "Unread",
          href: "/notifications",
          tone: "accent",
        },
        {
          id: "task-2",
          source: "workItem",
          title: "Fix iPad landscape",
          subtitle: "MOB-13 · blocked",
          badge: "Blocked",
          href: "/work-items/task-2/workspace",
          tone: "danger",
        },
        {
          id: "task-1",
          source: "workItem",
          title: "Ship mobile planning shell",
          subtitle: "MOB-12 · in progress",
          badge: "In Progress",
          href: "/work-items/task-1/workspace",
          tone: "default",
        },
      ],
      projectTotals: {
        total: 1,
        active: 1,
        tasks: 3,
        issues: 4,
      },
      executionSummary: {
        inProgress: 1,
        inReview: 0,
        blocked: 1,
      },
    });
  });

  it("groups mobile work into explicit pipeline lanes", () => {
    expect(
      groupPlanningWorkItems([
        {
          id: "ready",
          identifier: "BOB-1",
          title: "Ready task",
          kind: "task",
          status: "ready",
        },
        {
          id: "active",
          identifier: "BOB-2",
          title: "Active task",
          kind: "task",
          status: "in_progress",
        },
        {
          id: "review",
          identifier: "BOB-3",
          title: "Review task",
          kind: "task",
          status: "in_review",
        },
        {
          id: "done",
          identifier: "BOB-4",
          title: "Done task",
          kind: "task",
          status: "done",
        },
      ]),
    ).toEqual({
      queued: [
        {
          id: "ready",
          identifier: "BOB-1",
          title: "Ready task",
          kind: "task",
          status: "ready",
        },
      ],
      active: [
        {
          id: "active",
          identifier: "BOB-2",
          title: "Active task",
          kind: "task",
          status: "in_progress",
        },
      ],
      review: [
        {
          id: "review",
          identifier: "BOB-3",
          title: "Review task",
          kind: "task",
          status: "in_review",
        },
      ],
      done: [
        {
          id: "done",
          identifier: "BOB-4",
          title: "Done task",
          kind: "task",
          status: "done",
        },
      ],
    });
  });
});
