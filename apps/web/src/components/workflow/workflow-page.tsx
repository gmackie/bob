"use client";

import { useMemo } from "react";

import {
  detectStage,
  STAGES,
  type StageDetectionInput,
  type WorkflowStage,
} from "~/lib/workflow/stage";

import { PipelineIndicator } from "./pipeline-indicator";
import { StageTransition } from "./stage-transition";
import { StageIdea } from "./stage-idea";
import { StageShape } from "./stage-shape";
import { StagePlan } from "./stage-plan";
import { StageExecute } from "./stage-execute";
import { StageReview } from "./stage-review";
import { StageDeploy } from "./stage-deploy";
import { StageLive } from "./stage-live";

export interface WorkflowPageProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    priority: string;
    project: {
      id: string;
      name: string;
      key: string;
    } | null;
  };
  requirements: { count: number };
  childTasks: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
    branch?: string;
    duration?: string;
  }>;
  dispatch: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  } | null;
  pullRequests: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    ciPassing: boolean;
    reviewStatus: string;
  }>;
  deployments: Array<{
    id: string;
    environment: string;
    status: string;
    deployedAt?: string;
  }>;
  comments: Array<{
    id: string;
    body: string;
    userId: string;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    artifactRole: string;
    url: string;
    title: string | null;
  }>;
  onOpenPlanningSession: () => void;
  onBreakIntoTasks: () => void;
  onDispatchAgents: () => void;
  onMergeAndDeploy: () => void;
}

/** Map stage keys to their corresponding section components. */
const STAGE_KEYS = STAGES.map((s) => s.key);

export function WorkflowPage({
  workItem,
  requirements,
  childTasks,
  dispatch,
  pullRequests,
  deployments,
  comments,
  artifacts,
  onOpenPlanningSession,
  onBreakIntoTasks,
  onDispatchAgents,
  onMergeAndDeploy,
}: WorkflowPageProps) {
  // --- Detect stage ---
  const dispatchedCount = childTasks.filter(
    (t) =>
      t.status === "in_progress" ||
      t.status === "done" ||
      t.status === "in_review",
  ).length;
  const completedCount = childTasks.filter(
    (t) => t.status === "done",
  ).length;

  const detectionInput: StageDetectionInput = {
    workItem: { kind: workItem.kind, status: workItem.status },
    requirementCount: requirements.count,
    childTaskCount: childTasks.length,
    dispatchedTaskCount: dispatch?.total ?? dispatchedCount,
    completedTaskCount: dispatch?.completed ?? completedCount,
    openPRCount: pullRequests.filter((pr) => pr.status === "open").length,
    mergedFeaturePR: pullRequests.some((pr) => pr.status === "merged"),
    healthyDeployment: deployments.some((d) => d.status === "healthy"),
  };

  const detection = useMemo(() => detectStage(detectionInput), [
    detectionInput.requirementCount,
    detectionInput.childTaskCount,
    detectionInput.dispatchedTaskCount,
    detectionInput.completedTaskCount,
    detectionInput.openPRCount,
    detectionInput.mergedFeaturePR,
    detectionInput.healthyDeployment,
    detectionInput.workItem.kind,
    detectionInput.workItem.status,
  ]);

  const { stage: currentStage, stageIndex } = detection;

  // --- Transition handler ---
  function handleTransition(action: string) {
    if (action.includes("Shape")) onOpenPlanningSession();
    else if (action.includes("Break")) onBreakIntoTasks();
    else if (action.includes("Dispatch")) onDispatchAgents();
    else if (action.includes("Merge")) onMergeAndDeploy();
  }

  // --- Scroll to stage section ---
  function handleStageClick(stage: WorkflowStage) {
    const el = document.getElementById(`stage-${stage}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // --- Shared work-item prop for stage components ---
  const stageWorkItem = {
    id: workItem.id,
    title: workItem.title,
    description: workItem.description,
    kind: workItem.kind,
    status: workItem.status,
    identifier: workItem.identifier,
  };

  // --- Compute dispatch status ---
  const dispatchStatus = dispatch ?? {
    total: childTasks.length,
    completed: completedCount,
    failed: 0,
    running: childTasks.filter((t) => t.status === "in_progress").length,
  };

  // --- Find latest production deployment date ---
  const latestProdDeployment = deployments.find(
    (d) => d.environment === "production" && d.status === "healthy",
  );

  // --- Stages to render (up to and including current) ---
  const stagesToRender = STAGE_KEYS.slice(0, stageIndex + 1);

  return (
    <div className="space-y-6">
      {/* Pipeline indicator — sticky */}
      <div className="sticky top-0 z-10 bg-background rounded-2xl border border-border p-4">
        <PipelineIndicator
          currentStage={currentStage}
          onStageClick={handleStageClick}
        />
      </div>

      {/* Stage sections */}
      {stagesToRender.map((stageKey) => {
        const isCompleted = STAGE_KEYS.indexOf(stageKey) < stageIndex;
        const isCurrent = stageKey === currentStage;

        return (
          <div key={stageKey} id={`stage-${stageKey}`}>
            {renderStageSection(stageKey, isCompleted, isCurrent)}
          </div>
        );
      })}

      {/* Transition banner after the current stage */}
      <StageTransition
        currentStage={currentStage}
        onTransition={handleTransition}
      />
    </div>
  );

  function renderStageSection(
    stageKey: WorkflowStage,
    isCompleted: boolean,
    isCurrentStage: boolean,
  ) {
    const commonProps = {
      workItemId: workItem.id,
      workItem: stageWorkItem,
      isCompleted,
      isCurrentStage,
    };

    switch (stageKey) {
      case "idea":
        return <StageIdea {...commonProps} />;

      case "shape":
        return (
          <StageShape
            {...commonProps}
            requirementCount={requirements.count}
          />
        );

      case "plan":
        return (
          <StagePlan {...commonProps} childTasks={childTasks} />
        );

      case "execute":
        return (
          <StageExecute
            {...commonProps}
            dispatchStatus={dispatchStatus}
            tasks={childTasks}
          />
        );

      case "review":
        return (
          <StageReview {...commonProps} pullRequests={pullRequests} />
        );

      case "deploy":
        return (
          <StageDeploy {...commonProps} deployments={deployments} />
        );

      case "live":
        return (
          <StageLive
            {...commonProps}
            deployedAt={latestProdDeployment?.deployedAt}
          />
        );

      default:
        return null;
    }
  }
}
