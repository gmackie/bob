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
}: WorkflowPageClientProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const createSession = useMutation(
    trpc.planSession.create.mutationOptions(),
  );
  const [launchIntent, setLaunchIntent] = useState<WorkflowLaunchIntent | null>(
    null,
  );

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
        pullRequests={[]}
        deployments={[]}
        comments={comments}
        artifacts={artifacts}
        onOpenPlanningSession={() => {
          setLaunchIntent("shape");
        }}
        onBreakIntoTasks={() => {
          setLaunchIntent("breakdown");
        }}
        onDispatchAgents={async () => {
          toast("Starting agents on child tasks...");

          let started = 0;
          for (const child of childTasks) {
            if (child.status === "todo" || child.status === "backlog" || child.status === "draft") {
              try {
                await fetch("/api/trpc/taskRun.execute", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ "0": { json: { workItemId: child.id } } }),
                });
                started++;
              } catch (err: any) {
                console.error(`Failed to start agent on ${child.identifier}:`, err);
              }
            }
          }

          toast(`${started} agents dispatched! Check each task's workspace for progress.`);
          router.refresh();
        }}
        onMergeAndDeploy={() => {
          toast("Initiating merge & deploy...");
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
