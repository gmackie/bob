/**
 * Aggregate layer that maps handler factory outputs to ProjectsRpc contract
 * names (56 procedures).
 *
 * Imports the seven handler factories (project, workspace, repository,
 * pullRequest, featureBranch, gitProviders, git), instantiates them with a
 * HandlerContext, and wires each factory key to the corresponding contract
 * procedure name expected by ProjectsRpc.toLayer().
 *
 * Two gmacko-only RPCs (getBySlug, delete) have no Bob equivalent and are
 * stubbed with BobNotFoundError.
 *
 * Phase 7B-4D-delta Task 2.
 */
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { BobNotFoundError } from "@gmacko/bob/contracts";
import { makeProjectRpcHandlers } from "../rpc-handlers/project.js";
import { makeWorkspaceRpcHandlers } from "../rpc-handlers/workspace.js";
import { makeRepositoryRpcHandlers } from "../rpc-handlers/repository.js";
import { makePullRequestRpcHandlers } from "../rpc-handlers/pullRequest.js";
import { makeFeatureBranchRpcHandlers } from "../rpc-handlers/featureBranch.js";
import { makeGitProvidersRpcHandlers } from "../rpc-handlers/gitProviders.js";
import { makeGitRpcHandlers } from "../rpc-handlers/git.js";

export const makeProjectsLayer = (ctx: HandlerContext) => {
  const proj = makeProjectRpcHandlers(ctx);
  const ws = makeWorkspaceRpcHandlers(ctx);
  const repo = makeRepositoryRpcHandlers(ctx);
  const pr = makePullRequestRpcHandlers(ctx);
  const fb = makeFeatureBranchRpcHandlers(ctx);
  const gp = makeGitProvidersRpcHandlers(ctx);
  const git = makeGitRpcHandlers(ctx);

  return ProjectsRpc.toLayer({
    // --- Stubs (2) — gmacko-only, no Bob equivalent ---
    "projects.getBySlug": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "project", id: "not-implemented" }),
      ),
    "projects.delete": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "project", id: "not-implemented" }),
      ),

    // --- Project (6) — project.* → projects.* ---
    "projects.create": proj["project.create"],
    "projects.list": proj["project.list"],
    "projects.get": proj["project.get"],
    "projects.updateAutomationSettings":
      proj["project.updateAutomationSettings"],
    "projects.discovery": proj["project.discovery"],
    "projects.dismissDir": proj["project.dismissDir"],

    // --- Workspace (4) — workspace.* → projects.workspace.* ---
    "projects.workspace.list": ws["workspace.list"],
    "projects.workspace.create": ws["workspace.create"],
    "projects.workspace.rename": ws["workspace.rename"],
    "projects.workspace.delete": ws["workspace.delete"],

    // --- Repository (12) — repository.* → projects.repository.* ---
    "projects.repository.list": repo["repository.list"],
    "projects.repository.byId": repo["repository.byId"],
    "projects.repository.add": repo["repository.add"],
    "projects.repository.addFromProvider": repo["repository.addFromProvider"],
    "projects.repository.delete": repo["repository.delete"],
    "projects.repository.refreshMainBranch":
      repo["repository.refreshMainBranch"],
    "projects.repository.getWorktrees": repo["repository.getWorktrees"],
    "projects.repository.createWorktree": repo["repository.createWorktree"],
    "projects.repository.getWorktreePlanning":
      repo["repository.getWorktreePlanning"],
    "projects.repository.updateWorktreePlanning":
      repo["repository.updateWorktreePlanning"],
    "projects.repository.deleteWorktree": repo["repository.deleteWorktree"],
    "projects.repository.getWorktreeMergeStatus":
      repo["repository.getWorktreeMergeStatus"],

    // --- Pull Request (12) — pullRequest.* → projects.pullRequest.* ---
    "projects.pullRequest.list": pr["pullRequest.list"],
    "projects.pullRequest.get": pr["pullRequest.get"],
    "projects.pullRequest.listByRepository":
      pr["pullRequest.listByRepository"],
    "projects.pullRequest.listBySession": pr["pullRequest.listBySession"],
    "projects.pullRequest.create": pr["pullRequest.create"],
    "projects.pullRequest.update": pr["pullRequest.update"],
    "projects.pullRequest.merge": pr["pullRequest.merge"],
    "projects.pullRequest.syncCommits": pr["pullRequest.syncCommits"],
    "projects.pullRequest.linkToPlanningTask":
      pr["pullRequest.linkToPlanningTask"],
    "projects.pullRequest.refresh": pr["pullRequest.refresh"],
    "projects.pullRequest.listReviews": pr["pullRequest.listReviews"],
    "projects.pullRequest.addReview": pr["pullRequest.addReview"],

    // --- Feature Branch (7) — featureBranch.* → projects.featureBranch.* ---
    "projects.featureBranch.create": fb["featureBranch.create"],
    "projects.featureBranch.get": fb["featureBranch.get"],
    "projects.featureBranch.list": fb["featureBranch.list"],
    "projects.featureBranch.addTaskPR": fb["featureBranch.addTaskPR"],
    "projects.featureBranch.markTaskPRMerged":
      fb["featureBranch.markTaskPRMerged"],
    "projects.featureBranch.createFeaturePR":
      fb["featureBranch.createFeaturePR"],
    "projects.featureBranch.updateStatus": fb["featureBranch.updateStatus"],

    // --- Git Provider (6) — gitProviders.* → projects.gitProvider.* ---
    "projects.gitProvider.listConnections": gp["gitProviders.listConnections"],
    "projects.gitProvider.connectPat": gp["gitProviders.connectPat"],
    "projects.gitProvider.disconnect": gp["gitProviders.disconnect"],
    "projects.gitProvider.testConnection": gp["gitProviders.testConnection"],
    "projects.gitProvider.setDefaultForRepo":
      gp["gitProviders.setDefaultForRepo"],
    "projects.gitProvider.detectRemote": gp["gitProviders.detectRemote"],

    // --- Git (7) — git.* → projects.git.* ---
    "projects.git.pushAndCreatePr": git["git.pushAndCreatePr"],
    "projects.git.jjIsRepo": git["git.jjIsRepo"],
    "projects.git.jjLog": git["git.jjLog"],
    "projects.git.jjNew": git["git.jjNew"],
    "projects.git.jjDescribe": git["git.jjDescribe"],
    "projects.git.jjSquash": git["git.jjSquash"],
    "projects.git.jjDiff": git["git.jjDiff"],
  });
};
