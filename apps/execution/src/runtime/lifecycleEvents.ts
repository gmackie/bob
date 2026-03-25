export type RunPhase = "shape" | "plan" | "execute" | "review" | "ship";

export type LifecycleEventType =
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "phase_changed"
  | "artifact_created"
  | "plan_approved"
  | "plan_rejected"
  | "brd_generated"
  | "tasks_dispatched";

export interface LifecycleEventInput {
  taskRunId: string;
  workItemId?: string;
  sessionId?: string;
  eventType: LifecycleEventType;
  phase: RunPhase;
  metadata?: Record<string, unknown>;
}

export interface LifecycleEvent {
  taskRunId: string;
  workItemId: string | null;
  sessionId: string | null;
  eventType: LifecycleEventType;
  phase: RunPhase;
  metadata: Record<string, unknown>;
}

export function buildLifecycleEvent(input: LifecycleEventInput): LifecycleEvent {
  return {
    taskRunId: input.taskRunId,
    workItemId: input.workItemId ?? null,
    sessionId: input.sessionId ?? null,
    eventType: input.eventType,
    phase: input.phase,
    metadata: input.metadata ?? {},
  };
}
