"use client";

import { useRouter } from "next/navigation";
import { toast } from "@bob/ui/toast";

import { WorkflowPage, type WorkflowPageProps } from "~/components/workflow/workflow-page";
import { WorkItemDetailInteractive } from "~/components/work-items/work-item-detail-interactive";

interface WorkflowPageClientProps {
  workItem: WorkflowPageProps["workItem"];
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
  requirements,
  childTasks,
  comments,
  artifacts,
  childCount,
}: WorkflowPageClientProps) {
  const router = useRouter();

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
        // Open the chat panel for this work item
        toast("Opening planning session...");
        // Navigate to workspace or trigger chat panel
        router.push(`/work-items/${workItem.id}/workspace`);
      }}
      onBreakIntoTasks={() => {
        toast("Breaking into tasks...");
        router.push(`/work-items/${workItem.id}/workspace`);
      }}
      onDispatchAgents={() => {
        toast("Dispatching agents...");
        router.push(`/work-items/${workItem.id}/workspace`);
      }}
      onMergeAndDeploy={() => {
        toast("Initiating merge & deploy...");
      }}
    />
  );
}
