// apps/web/src/components/review/review-page.tsx
"use client";

import { useState } from "react";
import { PipelineRail, type PipelineNode } from "./pipeline-rail";
import { TaskSelector, type TaskTab } from "./task-selector";
import { CodeReviewCard, type CodeReviewData } from "./code-review-card";
import { GateRow, type Gate } from "./gate-row";
import { BuildDetailCard, type BuildData } from "./build-detail-card";
import { TestReportViewer, type TestReportData } from "./test-report-viewer";
import { ArtifactPanel, type ArtifactItem } from "./artifact-panel";
import { formatLabel } from "~/lib/design/colors";

// ---------- prop types ----------
interface DispatchItemData {
  id: string;
  title: string;
  status: string;
  pipelineState: string | null;
  updatedAt: string;
}

interface RevisionData {
  id: string;
  revId: string;
  branch: string | null;
  gates: Gate[];
  builds: BuildData[];
}

export interface ReviewPageProps {
  workItemId: string;
  workItemIdentifier: string;
  workItemTitle: string;
  batchId: string;
  batchStatus: string;
  items: DispatchItemData[];
  revisions: Record<string, RevisionData>; // keyed by dispatchItem.id
  codeReviews: Record<string, CodeReviewData>; // keyed by dispatchItem.id
  testReports: Record<string, TestReportData>; // keyed by dispatchItem.id
  artifacts: ArtifactItem[];
  deployments: Array<{
    id: string;
    environment: string;
    status: string;
    deployedAt: string | null;
  }>;
}

// ---------- helpers ----------
const PIPELINE_STAGES = [
  { name: "Agent", statePrefix: null, anchorId: "section-agent" },
  { name: "Review", statePrefix: "awaiting_review", anchorId: "section-review" },
  { name: "Build", statePrefix: "building", anchorId: "section-build" },
  { name: "Gates", statePrefix: "gates_passed", anchorId: "section-gates" },
  { name: "Dev", statePrefix: "deploying_dev", anchorId: "section-dev" },
  { name: "Staging", statePrefix: "deploying_staging", anchorId: "section-staging" },
  { name: "Approve", statePrefix: "awaiting_prod_approval", anchorId: "section-approve" },
  { name: "Prod", statePrefix: "deploying_prod", anchorId: "section-prod" },
  { name: "Complete", statePrefix: "complete", anchorId: "section-complete" },
] as const;

const STATE_ORDER = [
  "agent_complete", "awaiting_review", "building", "gates_passed",
  "deploying_dev", "dev_healthy", "deploying_staging", "staging_healthy",
  "awaiting_prod_approval", "deploying_prod", "prod_healthy", "complete",
];

const FAILED_STATES = ["build_failed", "deploy_failed", "review_failed"];
const ACTIVE_STATES = ["building", "deploying_dev", "deploying_staging", "deploying_prod"];

function deriveNodeStatus(stageIndex: number, currentIndex: number, pipelineState: string | null): "done" | "active" | "failed" | "pending" | "approval" {
  if (!pipelineState) return stageIndex === 0 ? "active" : "pending";
  if (FAILED_STATES.includes(pipelineState)) {
    // Failed state — find which stage it maps to
    if (pipelineState === "build_failed" && stageIndex === 2) return "failed";
    if (pipelineState === "deploy_failed" && stageIndex >= 4 && stageIndex <= 7) return "failed";
    if (pipelineState === "review_failed" && stageIndex === 1) return "failed";
    if (stageIndex < currentIndex) return "done";
    return "pending";
  }
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) {
    if (pipelineState === "awaiting_prod_approval") return "approval";
    if (ACTIVE_STATES.includes(pipelineState)) return "active";
    return "active";
  }
  return "pending";
}

function stateToStageIndex(state: string | null): number {
  if (!state) return 0;
  const idx = STATE_ORDER.indexOf(state);
  if (idx === -1) return 0;
  // Map state index to pipeline stage index
  if (idx <= 0) return 0; // agent_complete
  if (idx <= 1) return 1; // awaiting_review
  if (idx <= 2) return 2; // building
  if (idx <= 3) return 3; // gates_passed
  if (idx <= 4) return 4; // deploying_dev
  if (idx <= 5) return 4; // dev_healthy
  if (idx <= 6) return 5; // deploying_staging
  if (idx <= 7) return 5; // staging_healthy
  if (idx <= 8) return 6; // awaiting_prod_approval
  if (idx <= 9) return 7; // deploying_prod
  if (idx <= 10) return 7; // prod_healthy
  return 8; // complete
}

function buildPipelineNodes(pipelineState: string | null): PipelineNode[] {
  const currentIndex = stateToStageIndex(pipelineState);
  return PIPELINE_STAGES.map((stage, i) => ({
    name: stage.name,
    status: deriveNodeStatus(i, currentIndex, pipelineState),
    anchorId: stage.anchorId,
  }));
}

// ---------- component ----------
export function ReviewPage(props: ReviewPageProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    props.items.length === 1 ? props.items[0]!.id : null,
  );

  // Determine which items to show
  const visibleItems = selectedTaskId
    ? props.items.filter((it) => it.id === selectedTaskId)
    : props.items;

  // Use the first visible item's pipeline state for the rail (or furthest-advanced for "All")
  const primaryItem = selectedTaskId
    ? visibleItems[0]
    : props.items.reduce((best, item) => {
        const bestIdx = stateToStageIndex(best?.pipelineState ?? null);
        const itemIdx = stateToStageIndex(item.pipelineState);
        return itemIdx > bestIdx ? item : best;
      }, props.items[0]);

  const pipelineNodes = buildPipelineNodes(primaryItem?.pipelineState ?? null);

  // Task tabs
  const taskTabs: TaskTab[] = props.items.map((item) => ({
    id: item.id,
    label: item.title.length > 30 ? item.title.slice(0, 30) + "..." : item.title,
    status: item.status as TaskTab["status"],
  }));

  return (
    <div className="flex min-h-screen flex-col">
      {/* Pipeline rail */}
      <PipelineRail nodes={pipelineNodes} />

      {/* Task selector */}
      <TaskSelector tasks={taskTabs} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />

      {/* Main content + sidebar */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-8">
        {/* Content area */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">
              Execution Review
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{props.workItemIdentifier}</span>
              <span>{props.workItemTitle}</span>
              <span className="text-border">·</span>
              <span>{props.items.filter(i => i.status === "completed").length}/{props.items.length} tasks done</span>
            </div>
          </div>

          {/* Code review cards */}
          {visibleItems.map((item) => {
            const review = props.codeReviews[item.id];
            if (!review) return null;
            return (
              <CodeReviewCard
                key={`cr-${item.id}`}
                review={review}
                workItemIdentifier={props.workItemIdentifier}
                taskLabel={selectedTaskId ? item.title : `Task: ${item.title}`}
              />
            );
          })}

          {/* Gate rows */}
          {visibleItems.map((item) => {
            const revision = props.revisions[item.id];
            if (!revision?.gates.length) return null;
            return <GateRow key={`gate-${item.id}`} gates={revision.gates} />;
          })}

          {/* Build cards */}
          {visibleItems.map((item) => {
            const revision = props.revisions[item.id];
            if (!revision?.builds.length) return null;
            return revision.builds.map((build) => (
              <BuildDetailCard
                key={build.id}
                build={{ ...build, commitSha: revision.revId }}
                artifacts={[
                  { type: "test", label: "Test Report", icon: "✅" },
                  { type: "image", label: "OCI Image", icon: "📦" },
                  { type: "log", label: "Build Log", icon: "📄" },
                ]}
              />
            ));
          })}

          {/* Test reports */}
          {visibleItems.map((item) => {
            const report = props.testReports[item.id];
            if (!report) return null;
            return <TestReportViewer key={`test-${item.id}`} report={report} />;
          })}

          {/* Phase 2 components will be added here */}
        </div>

        {/* Sidebar */}
        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          {/* Batch summary */}
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <h3 className="font-display text-sm font-semibold text-foreground">Dispatch Batch</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium text-foreground capitalize">{formatLabel(props.batchStatus)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-mono text-foreground">
                  {props.items.filter(i => i.status === "completed").length}/{props.items.length}
                </span>
              </div>
              {props.items.some(i => i.status === "failed") && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Failed</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">
                    {props.items.filter(i => i.status === "failed").length}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Artifact panel */}
          <ArtifactPanel artifacts={props.artifacts} />
        </aside>
      </div>
    </div>
  );
}
