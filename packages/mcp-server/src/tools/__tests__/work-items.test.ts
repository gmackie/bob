import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import {
  createWorkItemCommentTool,
  getWorkItemTool,
  listWorkItemActivitiesTool,
  listWorkItemCommentsTool,
  listWorkItemsTool,
  promoteWorkItemToTaskTool,
  updateWorkItemTool,
} from "../work-items.js";

function createMockContext(): ToolContext & {
  mockCallTrpc: ReturnType<typeof vi.fn>;
} {
  const mockCallTrpc = vi.fn();
  return {
    sessionId: null,
    callTrpc: mockCallTrpc,
    mockCallTrpc,
  };
}

afterEach(() => {
  delete process.env.BOB_WORKSPACE_ID;
  delete process.env.BOB_PROJECT_ID;
  vi.restoreAllMocks();
});

describe("work item tools", () => {
  describe("listWorkItemsTool", () => {
    it("requires a workspace_id when no default is configured", async () => {
      const ctx = createMockContext();
      const result = await listWorkItemsTool.handler({}, ctx);

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "workspace_id is required",
      );
    });

    it("uses configured default workspace and project ids", async () => {
      process.env.BOB_WORKSPACE_ID = "workspace-123";
      process.env.BOB_PROJECT_ID = "project-456";

      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue([
        {
          id: "task-1",
          identifier: "BOB-1",
          title: "First work item",
          kind: "task",
          status: "todo",
        },
      ]);

      const result = await listWorkItemsTool.handler({}, ctx);

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("workItems.list", {
        workspaceId: "workspace-123",
        projectId: "project-456",
        parentId: undefined,
        kind: undefined,
        status: undefined,
        limit: undefined,
      });
      expect(result.isError).toBeFalsy();

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.count).toBe(1);
      expect(data.workspaceId).toBe("workspace-123");
      expect(data.projectId).toBe("project-456");
    });
  });

  describe("getWorkItemTool", () => {
    it("looks up a work item by identifier", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        workItem: {
          id: "uuid-1",
          identifier: "BOB-42",
          title: "Implement integration",
          kind: "task",
          status: "in_progress",
        },
        currentArtifacts: [],
        childCount: 0,
      });

      const result = await getWorkItemTool.handler(
        { id_or_identifier: "BOB-42" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("workItems.get", {
        id: "BOB-42",
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe("updateWorkItemTool", () => {
    it("requires at least one editable field", async () => {
      const ctx = createMockContext();
      const result = await updateWorkItemTool.handler(
        { id_or_identifier: "BOB-42" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "At least one of title, description, or status must be provided",
      );
    });

    it("resolves an identifier before updating", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          workItem: {
            id: "uuid-1",
            identifier: "BOB-42",
            title: "Implement integration",
            kind: "task",
            status: "todo",
          },
          currentArtifacts: [],
          childCount: 0,
        })
        .mockResolvedValueOnce({
          id: "uuid-1",
          identifier: "BOB-42",
          title: "Implement Bob integration",
          kind: "task",
          status: "in_progress",
        });

      const result = await updateWorkItemTool.handler(
        {
          id_or_identifier: "BOB-42",
          status: "in_progress",
          title: "Implement Bob integration",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(1, "workItems.get", {
        id: "BOB-42",
      });
      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(2, "workItems.update", {
        id: "uuid-1",
        title: "Implement Bob integration",
        description: undefined,
        status: "in_progress",
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe("comment and activity tools", () => {
    it("lists comments after resolving a work item reference", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          workItem: {
            id: "uuid-1",
            identifier: "BOB-42",
            title: "Implement integration",
            kind: "task",
            status: "todo",
          },
          currentArtifacts: [],
          childCount: 0,
        })
        .mockResolvedValueOnce([
          { id: "comment-1", workItemId: "uuid-1", body: "Investigating" },
        ]);

      const result = await listWorkItemCommentsTool.handler(
        { id_or_identifier: "BOB-42" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(2, "workItems.listComments", {
        workItemId: "uuid-1",
      });
      expect(result.isError).toBeFalsy();
    });

    it("creates a comment after resolving a work item reference", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          workItem: {
            id: "uuid-1",
            identifier: "BOB-42",
            title: "Implement integration",
            kind: "task",
            status: "todo",
          },
          currentArtifacts: [],
          childCount: 0,
        })
        .mockResolvedValueOnce({
          id: "comment-1",
          workItemId: "uuid-1",
          body: "Started implementation",
        });

      const result = await createWorkItemCommentTool.handler(
        { id_or_identifier: "BOB-42", body: "Started implementation" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(
        2,
        "workItems.createComment",
        {
          workItemId: "uuid-1",
          body: "Started implementation",
          parentId: undefined,
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("lists activities after resolving a work item reference", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          workItem: {
            id: "uuid-1",
            identifier: "BOB-42",
            title: "Implement integration",
            kind: "task",
            status: "todo",
          },
          currentArtifacts: [],
          childCount: 0,
        })
        .mockResolvedValueOnce([
          { id: "activity-1", workItemId: "uuid-1", type: "status_changed" },
        ]);

      const result = await listWorkItemActivitiesTool.handler(
        { id_or_identifier: "BOB-42", limit: 10 },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(
        2,
        "workItems.listActivities",
        {
          workItemId: "uuid-1",
          limit: 10,
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe("promoteWorkItemToTaskTool", () => {
    it("promotes a work item after resolving the identifier", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          workItem: {
            id: "uuid-1",
            identifier: "BOB-42",
            title: "Implement integration",
            kind: "issue",
            status: "todo",
          },
          currentArtifacts: [],
          childCount: 0,
        })
        .mockResolvedValueOnce({
          id: "uuid-1",
          identifier: "BOB-42",
          title: "Implement integration",
          kind: "task",
          status: "todo",
        });

      const result = await promoteWorkItemToTaskTool.handler(
        { id_or_identifier: "BOB-42" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenNthCalledWith(
        2,
        "workItems.promoteToTask",
        {
          id: "uuid-1",
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });
});
