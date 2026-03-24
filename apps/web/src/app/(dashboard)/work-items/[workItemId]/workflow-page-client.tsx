"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@bob/ui/toast";

import { useTRPC } from "~/trpc/react";
import { WorkflowPage, type WorkflowPageProps } from "~/components/workflow/workflow-page";
import {
  WorkflowLaunchDialog,
  type WorkflowLaunchIntent,
} from "~/components/workflow/workflow-launch-dialog";
import { WorkItemDetailInteractive } from "~/components/work-items/work-item-detail-interactive";

interface WorkflowPageClientProps {
  workItem: WorkflowPageProps["workItem"];
  workspaceId: string;
  requirements: WorkflowPageProps["requirements"];
  childTasks: WorkflowPageProps["childTasks"];
  comments: WorkflowPageProps["comments"];
  artifacts: WorkflowPageProps["artifacts"];
  childCount: number;
  pullRequests: WorkflowPageProps["pullRequests"];
  deployments: WorkflowPageProps["deployments"];
}

/**
 * Client wrapper that decides between the workflow view (for epics/issues)
 * and the existing detail view (for tasks), and wires up transition callbacks.
 */
export function WorkflowPageClient({
  workItem,
  workspaceId,
  requirements,
  childTasks,
  comments,
  artifacts,
  childCount,
  pullRequests,
  deployments,
}: WorkflowPageClientProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const createSession = useMutation(
    trpc.planSession.create.mutationOptions(),
  );
  const executeTask = useMutation(
    trpc.taskRun.execute.mutationOptions(),
  );
  const mergePR = useMutation(
    trpc.pullRequest.merge.mutationOptions(),
  );
  const [launchIntent, setLaunchIntent] = useState<WorkflowLaunchIntent | null>(
    null,
  );
  const [dispatching, setDispatching] = useState(false);

  // For tasks, keep the existing detail view
  if (workItem.kind === "task") {
    return (
      <WorkItemDetailInteractive
        workItem={workItem}
        childCount={childCount}
        comments={comments}
        currentArtifacts={artifacts}
      />
    );
  }

  // For epics and issues, show the workflow view
  return (
    <>
      <WorkflowPage
        workItem={workItem}
        requirements={requirements}
        childTasks={childTasks}
        dispatch={null}
        pullRequests={pullRequests}
        deployments={deployments}
        comments={comments}
        artifacts={artifacts}
        onOpenPlanningSession={() => {
          setLaunchIntent("shape");
        }}
        onBreakIntoTasks={() => {
          setLaunchIntent("breakdown");
        }}
        onDispatchAgents={async () => {
          if (dispatching) return;
          setDispatching(true);
          toast("Starting agents on child tasks...");

          let started = 0;
          const dispatchable = childTasks.filter(
            (c) => c.status === "todo" || c.status === "backlog" || c.status === "draft",
          );

          for (const child of dispatchable) {
            try {
              await executeTask.mutateAsync({
                workItemId: child.id,
                agentType: "claude",
              });
              started++;
              toast(`Agent started on ${child.identifier} (${started}/${dispatchable.length})`);
            } catch (err: any) {
              console.error(`Failed to start agent on ${child.identifier}:`, err);
              toast(`Failed to start agent on ${child.identifier}: ${err.message ?? "Unknown error"}`);
            }
          }

          toast(`${started} agents dispatched! Check each task's workspace for progress.`);
          setDispatching(false);
          router.refresh();
        }}
        onMergeAndDeploy={async () => {
          // Find any open PRs from the pullRequests prop and merge them
          const openPRs = pullRequests.filter(
            (pr) => pr.status === "open" || pr.status === "draft",
          );

          if (openPRs.length === 0) {
            toast("No open pull requests to merge.");
            return;
          }

          toast(`Merging ${openPRs.length} pull request(s)...`);

          let merged = 0;
          for (const pr of openPRs) {
            try {
              await mergePR.mutateAsync({
                pullRequestId: pr.id,
                mergeMethod: "squash",
              });
              merged++;
              toast(`Merged PR #${pr.number}`);
            } catch (err: any) {
              console.error(`Failed to merge PR #${pr.number}:`, err);
              toast(`Failed to merge PR #${pr.number}: ${err.message ?? "Unknown error"}`);
            }
          }

          toast(`${merged} PR(s) merged! Deployment pipeline starting...`);
          router.refresh();
        }}
      />
      <WorkflowLaunchDialog
        open={launchIntent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLaunchIntent(null);
          }
        }}
        intent={launchIntent}
        workItem={{
          id: workItem.id,
          identifier: workItem.identifier,
          title: workItem.title,
          kind: workItem.kind,
        }}
        requirementCount={requirements.count}
        childTaskCount={childTasks.length}
        onConfirm={(launchContext) => {
          if (!workItem.project?.id) {
            toast("This workflow needs a project-linked work item to start planning.");
            return;
          }

          const title =
            launchContext.intent === "shape"
              ? `Shape ${workItem.title}`
              : `Plan ${workItem.title}`;
          const planningSessionType =
            launchContext.intent === "shape" ? "office_hours" as const : "breakdown" as const;

          createSession.mutate(
            {
              workItemId: workItem.id,
              workspaceId,
              projectId: workItem.project.id,
              title,
              planningSessionType,
            },
            {
              onSuccess: (session) => {
                setLaunchIntent(null);
                router.push(`/work-items/${workItem.id}/plan/${session.id}`);
              },
              onError: (err) => {
                toast(err.message ?? "Failed to create planning session");
              },
            },
          );
        }}
      />
    </>
  );
}
