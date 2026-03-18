"use client";

import { useState } from "react";
import { toast } from "@bob/ui/toast";

import { useChatPanel } from "~/components/chat/chat-panel-provider";
import { WorkflowPage, type WorkflowPageProps } from "~/components/workflow/workflow-page";
import {
  WorkflowLaunchDialog,
  type WorkflowLaunchIntent,
} from "~/components/workflow/workflow-launch-dialog";
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
  const chatPanel = useChatPanel();
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
        onDispatchAgents={() => {
          toast("Dispatching agents...");
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
        onConfirm={(input) => {
          if (input.selectedSourceIds.length > 0 || input.attachedFiles.length > 0) {
            toast(
              "Context bundle capture is in prototype mode for now. Opening the planning session next.",
            );
          }

          void chatPanel.openPlanningSession(
            workItem.id,
            input.intent === "shape"
              ? `Shape ${workItem.title}`
              : `Plan ${workItem.title}`,
          );
          setLaunchIntent(null);
        }}
      />
    </>
  );
}
