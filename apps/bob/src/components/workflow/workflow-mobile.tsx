"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@gmacko/core/ui";

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
import type { WorkflowPageProps } from "./workflow-page";

const STAGE_KEYS = STAGES.map((s) => s.key);

/**
 * Mobile-optimised workflow view.
 *
 * Renders each stage as a horizontally-swipeable card using CSS
 * scroll-snap. A bottom dots indicator shows the current card.
 * The pipeline indicator is rendered in compact (dots-only) mode
 * since labels are already hidden on viewports < sm.
 */
export function WorkflowMobile({
  workItem,
  requirements,
  childTasks,
  dispatch,
  pullRequests,
  deployments,
  comments,
  artifacts,
  sessionId,
  onOpenPlanningSession,
  onBreakIntoTasks,
  onDispatchAgents,
  onMergeAndDeploy,
}: WorkflowPageProps) {
  // --- Stage detection (same logic as WorkflowPage) ---
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

  // --- Scroll tracking ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  const stagesToRender = STAGE_KEYS.slice(0, stageIndex + 1);

  // Track which card is visible via IntersectionObserver
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.cardIndex,
            );
            if (!Number.isNaN(idx)) setActiveCardIndex(idx);
          }
        }
      },
      { root: container, threshold: 0.6 },
    );

    const cards = container.querySelectorAll("[data-card-index]");
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [stagesToRender.length]);

  // --- Transition handler ---
  function handleTransition(action: string) {
    if (action.includes("Shape")) onOpenPlanningSession();
    else if (action.includes("Break")) onBreakIntoTasks();
    else if (action.includes("Dispatch")) onDispatchAgents();
    else if (action.includes("Merge")) onMergeAndDeploy();
  }

  // --- Navigate to card via dots ---
  const scrollToCard = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const card = container.querySelector(
      `[data-card-index="${index}"]`,
    ) as HTMLElement | null;
    card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, []);

  // --- Shared work-item prop for stage components ---
  const stageWorkItem = {
    id: workItem.id,
    title: workItem.title,
    description: workItem.description,
    kind: workItem.kind,
    status: workItem.status,
    identifier: workItem.identifier,
  };

  const dispatchStatus = dispatch ?? {
    total: childTasks.length,
    completed: completedCount,
    failed: 0,
    running: childTasks.filter((t) => t.status === "in_progress").length,
  };

  const latestProdDeployment = deployments.find(
    (d) => d.environment === "production" && d.status === "healthy",
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
        return <StagePlan {...commonProps} childTasks={childTasks} />;
      case "execute":
        return (
          <StageExecute
            {...commonProps}
            dispatchStatus={dispatchStatus}
            tasks={childTasks}
          />
        );
      case "review":
        return <StageReview {...commonProps} pullRequests={pullRequests} />;
      case "deploy":
        return <StageDeploy {...commonProps} deployments={deployments} />;
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

  return (
    <div className="flex flex-col h-full">
      {/* Compact pipeline indicator (dots only at this viewport) */}
      <div className="sticky top-0 z-10 bg-background rounded-2xl border border-border px-3 py-2">
        <PipelineIndicator
          currentStage={currentStage}
          onStageClick={(stage) => {
            const idx = stagesToRender.indexOf(stage);
            if (idx >= 0) scrollToCard(idx);
          }}
        />
      </div>

      {/* Swipeable card container */}
      <div
        ref={scrollRef}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory scroll-smooth gap-4 px-4 py-4"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        {stagesToRender.map((stageKey, idx) => {
          const isCompleted = STAGE_KEYS.indexOf(stageKey) < stageIndex;
          const isCurrent = stageKey === currentStage;

          return (
            <div
              key={stageKey}
              data-card-index={idx}
              className={cn(
                "snap-start shrink-0 w-full rounded-2xl border border-border",
                "bg-background p-4 overflow-y-auto",
              )}
            >
              {renderStageSection(stageKey, isCompleted, isCurrent)}

              {/* Transition banner inside the current stage card */}
              {isCurrent && (
                <div className="mt-4">
                  <StageTransition
                    currentStage={currentStage}
                    onTransition={handleTransition}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom dots indicator */}
      <div className="flex justify-center gap-2 py-3">
        {stagesToRender.map((stageKey, idx) => (
          <button
            key={stageKey}
            type="button"
            onClick={() => scrollToCard(idx)}
            className={cn(
              "h-2 rounded-full transition-all duration-200",
              idx === activeCardIndex
                ? "w-6 bg-primary"
                : "w-2 bg-muted-foreground/30",
            )}
            aria-label={`Go to ${stageKey} stage`}
          />
        ))}
      </div>
    </div>
  );
}
