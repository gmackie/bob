export type WorkflowStage =
  | "idea"
  | "shape"
  | "plan"
  | "execute"
  | "review"
  | "deploy"
  | "live";

export const STAGES: { key: WorkflowStage; label: string; icon: string }[] = [
  { key: "idea", label: "Idea", icon: "💡" },
  { key: "shape", label: "Shape", icon: "📐" },
  { key: "plan", label: "Plan", icon: "📋" },
  { key: "execute", label: "Execute", icon: "🤖" },
  { key: "review", label: "Review", icon: "👀" },
  { key: "deploy", label: "Deploy", icon: "🚀" },
  { key: "live", label: "Live", icon: "📊" },
];

const STAGE_KEYS: WorkflowStage[] = STAGES.map((s) => s.key);

/** Maps each stage to the user-facing next-action prompt (null = auto-transition). */
const NEXT_ACTIONS: Record<WorkflowStage, string | null> = {
  idea: "Shape this idea with Bob →",
  shape: "Break into tasks →",
  plan: "Dispatch agents →",
  execute: null,
  review: "Merge & deploy →",
  deploy: null,
  live: null,
};

export interface StageDetectionInput {
  workItem: { kind: string; status: string };
  requirementCount: number;
  childTaskCount: number;
  dispatchedTaskCount: number;
  completedTaskCount: number;
  openPRCount: number;
  mergedFeaturePR: boolean;
  healthyDeployment: boolean;
  artifactCount?: number; // Planning artifacts (BRDs, design docs)
  sessionCount?: number; // Completed planning sessions
}

export interface StageDetectionResult {
  stage: WorkflowStage;
  stageIndex: number;
  completedStages: WorkflowStage[];
  nextAction: string | null;
}

/**
 * Determines the current workflow stage based on observable state.
 *
 * Priority (highest first):
 *   healthyDeployment          → live
 *   mergedFeaturePR            → deploy
 *   openPRCount > 0 && all tasks done → review
 *   dispatchedTaskCount > 0    → execute
 *   childTaskCount > 0         → plan
 *   requirementCount > 0       → shape
 *   (default)                  → idea
 */
export function detectStage(input: StageDetectionInput): StageDetectionResult {
  let stage: WorkflowStage;

  if (input.healthyDeployment) {
    stage = "live";
  } else if (input.mergedFeaturePR) {
    stage = "deploy";
  } else if (
    input.openPRCount > 0 &&
    input.childTaskCount > 0 &&
    input.completedTaskCount === input.childTaskCount
  ) {
    stage = "review";
  } else if (input.dispatchedTaskCount > 0) {
    stage = "execute";
  } else if (input.childTaskCount > 0) {
    stage = "plan";
  } else if (input.requirementCount > 0 || (input.artifactCount ?? 0) > 0) {
    stage = "shape";
  } else {
    stage = "idea";
  }

  const stageIndex = STAGE_KEYS.indexOf(stage);
  const completedStages = STAGE_KEYS.slice(0, stageIndex);
  const nextAction = NEXT_ACTIONS[stage];

  return { stage, stageIndex, completedStages, nextAction };
}
