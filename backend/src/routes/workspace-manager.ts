import { Router } from "express";

import { WorkspaceManagerService } from "../services/workspace-manager.js";

function requireIdempotencyKey(req: any, res: any): string | null {
  const key = req.header("X-Idempotency-Key");
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    res.status(400).json({ error: "X-Idempotency-Key header is required" });
    return null;
  }
  return key.trim();
}

function handleIdempotencyError(res: any, error: Error): boolean {
  if (error.message === "IDEMPOTENCY_CONFLICT") {
    res.status(409).json({
      error: "Idempotency key conflicts with a different payload",
    });
    return true;
  }
  if (error.message === "IDEMPOTENCY_IN_PROGRESS") {
    res.status(409).json({
      error: "Operation with this idempotency key is still in progress",
    });
    return true;
  }
  if (error.message === "IDEMPOTENCY_PREVIOUSLY_FAILED") {
    res.status(409).json({
      error: "Operation with this idempotency key previously failed",
    });
    return true;
  }
  return false;
}

export function createWorkspaceManagerRoutes(
  workspaceManager: WorkspaceManagerService,
): Router {
  const router = Router();

  router.post("/repos/:repoId/runs", async (req: any, res: any) => {
    let operation: any | null = null;
    try {
      const idempotencyKey = requireIdempotencyKey(req, res);
      if (!idempotencyKey) return;

      const { task_id, run_id, agent_id, base_ref } = req.body || {};
      if (!task_id || !run_id || !agent_id) {
        return res
          .status(400)
          .json({ error: "task_id, run_id, and agent_id are required" });
      }
      if (!WorkspaceManagerService.isValidRunId(run_id)) {
        return res.status(400).json({ error: "run_id format is invalid" });
      }

      const requestPayload = {
        task_id,
        run_id,
        agent_id,
        base_ref: base_ref || "base",
      };
      const requestHash = WorkspaceManagerService.hashRequest(requestPayload);

      const { operation: createdOperation, alreadyExisted } =
        await workspaceManager.getOrCreateOperation(
          run_id,
          "create_run_workspace",
          idempotencyKey,
          requestHash,
          req.userId,
        );
      operation = createdOperation;

      if (alreadyExisted && operation.resultJson) {
        return res.status(200).json(JSON.parse(operation.resultJson));
      }

      const run = await workspaceManager.createRunWorkspace(
        req.params.repoId,
        {
          taskId: task_id,
          runId: run_id,
          agentId: agent_id,
          baseRef: base_ref,
        },
        req.userId,
      );

      const response = {
        workspace_id: run.workspaceId,
        workspace_path: run.workspacePath,
        rev_id: run.headRev,
        base_rev: run.baseRev,
        status: run.status,
      };

      await workspaceManager.finalizeOperation(
        operation,
        "succeeded",
        response,
      );
      return res.status(201).json(response);
    } catch (error) {
      const typedError = error as Error;
      if (operation) {
        try {
          await workspaceManager.finalizeOperation(
            operation,
            "failed",
            undefined,
            typedError.message,
          );
        } catch (finalizeError) {
          console.error(
            "Failed to finalize create_run_workspace operation",
            finalizeError,
          );
        }
      }
      if (handleIdempotencyError(res, typedError)) {
        return;
      }
      return res
        .status(500)
        .json({ error: `Failed to create run workspace: ${error}` });
    }
  });

  router.get("/runs/:runId", async (req: any, res: any) => {
    try {
      if (!WorkspaceManagerService.isValidRunId(req.params.runId)) {
        return res.status(400).json({ error: "run_id format is invalid" });
      }
      const run = await workspaceManager.getRunStatus(
        req.params.runId,
        req.userId,
      );
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      return res.json({
        run_id: run.runId,
        task_id: run.taskId,
        workspace_id: run.workspaceId,
        rev_id: run.headRev,
        base_rev: run.baseRev,
        integration_rev: run.headRev,
        status: run.status,
        test_status: run.testStatus || "not_started",
      });
    } catch (error) {
      return res
        .status(500)
        .json({ error: `Failed to get run status: ${error}` });
    }
  });

  router.post("/runs/:runId/apply-patch", async (req: any, res: any) => {
    let operation: any | null = null;
    try {
      if (!WorkspaceManagerService.isValidRunId(req.params.runId)) {
        return res.status(400).json({ error: "run_id format is invalid" });
      }
      const idempotencyKey = requireIdempotencyKey(req, res);
      if (!idempotencyKey) return;

      const { patch } = req.body || {};
      if (!patch || typeof patch !== "string") {
        return res.status(400).json({ error: "patch is required" });
      }

      const requestHash = WorkspaceManagerService.hashRequest({ patch });
      const { operation: createdOperation, alreadyExisted } =
        await workspaceManager.getOrCreateOperation(
          req.params.runId,
          "apply_patch",
          idempotencyKey,
          requestHash,
          req.userId,
        );
      operation = createdOperation;

      if (alreadyExisted && operation.resultJson) {
        return res.status(200).json(JSON.parse(operation.resultJson));
      }

      const run = await workspaceManager.applyPatch(
        req.params.runId,
        { patch },
        req.userId,
      );
      const response = {
        rev_id: run.headRev,
        status: run.status,
      };
      await workspaceManager.finalizeOperation(
        operation,
        "succeeded",
        response,
      );
      return res.json(response);
    } catch (error) {
      const typedError = error as Error;
      if (operation) {
        try {
          await workspaceManager.finalizeOperation(
            operation,
            "failed",
            undefined,
            typedError.message,
          );
        } catch (finalizeError) {
          console.error(
            "Failed to finalize apply_patch operation",
            finalizeError,
          );
        }
      }
      if (handleIdempotencyError(res, typedError)) {
        return;
      }
      return res
        .status(500)
        .json({ error: `Failed to apply patch: ${typedError.message}` });
    }
  });

  router.post("/runs/:runId/describe", async (req: any, res: any) => {
    let operation: any | null = null;
    try {
      if (!WorkspaceManagerService.isValidRunId(req.params.runId)) {
        return res.status(400).json({ error: "run_id format is invalid" });
      }
      const idempotencyKey = requireIdempotencyKey(req, res);
      if (!idempotencyKey) return;

      const { message } = req.body || {};
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const requestHash = WorkspaceManagerService.hashRequest({ message });
      const { operation: createdOperation, alreadyExisted } =
        await workspaceManager.getOrCreateOperation(
          req.params.runId,
          "describe_changeset",
          idempotencyKey,
          requestHash,
          req.userId,
        );
      operation = createdOperation;

      if (alreadyExisted && operation.resultJson) {
        return res.status(200).json(JSON.parse(operation.resultJson));
      }

      const run = await workspaceManager.describeChangeset(
        req.params.runId,
        { message },
        req.userId,
      );
      const response = {
        rev_id: run.headRev,
        description_updated: true,
      };

      await workspaceManager.finalizeOperation(
        operation,
        "succeeded",
        response,
      );
      return res.json(response);
    } catch (error) {
      const typedError = error as Error;
      if (operation) {
        try {
          await workspaceManager.finalizeOperation(
            operation,
            "failed",
            undefined,
            typedError.message,
          );
        } catch (finalizeError) {
          console.error(
            "Failed to finalize describe_changeset operation",
            finalizeError,
          );
        }
      }
      if (handleIdempotencyError(res, typedError)) {
        return;
      }
      return res
        .status(500)
        .json({ error: `Failed to describe changeset: ${typedError.message}` });
    }
  });

  router.delete("/runs/:runId", async (req: any, res: any) => {
    let operation: any | null = null;
    try {
      if (!WorkspaceManagerService.isValidRunId(req.params.runId)) {
        return res.status(400).json({ error: "run_id format is invalid" });
      }
      const idempotencyKey = requireIdempotencyKey(req, res);
      if (!idempotencyKey) return;

      const requestHash = WorkspaceManagerService.hashRequest({
        runId: req.params.runId,
      });
      const { operation: createdOperation, alreadyExisted } =
        await workspaceManager.getOrCreateOperation(
          req.params.runId,
          "cleanup_run",
          idempotencyKey,
          requestHash,
          req.userId,
        );
      operation = createdOperation;

      if (alreadyExisted && operation.resultJson) {
        return res.status(200).json(JSON.parse(operation.resultJson));
      }

      const run = await workspaceManager.getRunStatus(
        req.params.runId,
        req.userId,
      );
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      await workspaceManager.cleanupRun(req.params.runId, req.userId);
      const response = {
        run_id: run.runId,
        workspace_id: run.workspaceId,
        status: "ABANDONED",
      };

      await workspaceManager.finalizeOperation(
        operation,
        "succeeded",
        response,
      );
      return res.json(response);
    } catch (error) {
      const typedError = error as Error;
      if (operation) {
        try {
          await workspaceManager.finalizeOperation(
            operation,
            "failed",
            undefined,
            typedError.message,
          );
        } catch (finalizeError) {
          console.error(
            "Failed to finalize cleanup_run operation",
            finalizeError,
          );
        }
      }
      if (handleIdempotencyError(res, typedError)) {
        return;
      }
      return res
        .status(500)
        .json({ error: `Failed to cleanup run: ${typedError.message}` });
    }
  });

  return router;
}
