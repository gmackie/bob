# Phase 3: Code Review Gate & Ship Automation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a code-reviewer agent profile, insert a review gate into the pipeline orchestrator, auto-create feature PRs, and display review status in the UI — closing the review gap between task execution and deploy.

**Architecture:** Modify `handleAgentComplete` in the pipeline orchestrator to transition to `awaiting_review` instead of `building`. The new `handleAwaitingReview` handler polls for a `code_review` artifact via the existing `checkProgress` loop. A code-reviewer smol-agent session is triggered when dispatch transitions items to `in_review`. Review artifacts use the existing `workItemArtifacts` table with a new `code_review` type. Feature PR auto-creation extends `feature-assembly.ts`.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, Next.js/tRPC, smol-agent ACP

## Preconditions

- Phase 2b must be committed (run hierarchy, lifecycle events, shape profile)
- All existing tests must pass
- The `workItemArtifactType` enum in PostgreSQL must accept `ALTER TYPE ... ADD VALUE` (standard pgEnum extension)

## Task 1: Add code_review artifact type and review activity types

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0013_review_artifact_type.sql`

**Step 1: Write the migration**

Create `packages/db/drizzle/0013_review_artifact_type.sql`:

```sql
ALTER TYPE work_item_artifact_type ADD VALUE IF NOT EXISTS 'code_review';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_requested';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_approved';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'review_changes_requested';
```

**Step 2: Update schema.ts enums**

In `packages/db/src/schema.ts`, add `"code_review"` to `workItemArtifactType` array (line ~117) and add `"review_requested"`, `"review_approved"`, `"review_changes_requested"` to `workItemActivityType` array (line ~87).

**Step 3: Build and verify**

```bash
npx turbo build --filter=@bob/db && npx tsc --noEmit --project packages/api/tsconfig.json
```

**Step 4: Commit**

```bash
git add packages/db/drizzle/0013_review_artifact_type.sql packages/db/src/schema.ts
git commit -m "feat: add code_review artifact type and review activity types"
```

## Task 2: Create code-reviewer smol-agent profile

**Files:**
- Create: `apps/execution/src/planning/smolAgentReviewProfile.ts`
- Create: `apps/execution/src/planning/__tests__/smolAgentReviewProfile.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildSmolAgentReviewProfile } from "../smolAgentReviewProfile";

describe("smolAgentReviewProfile", () => {
  it("builds a review profile with correct agent type and phase", () => {
    const profile = buildSmolAgentReviewProfile({
      sessionId: "session-1",
      workItemId: "wi-1",
      pullRequestId: "pr-1",
      workItemTitle: "Add auth module",
      prDiffUrl: "https://github.com/org/repo/pull/42.diff",
      requirements: ["User can login", "Session expires after 30 min"],
      taskDescription: "Implement OAuth2 login flow",
      workingDirectory: "/tmp/project",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.runPhase).toBe("review");
    expect(profile.env.BOB_RUN_PHASE).toBe("review");
    expect(profile.env.BOB_PR_DIFF_URL).toBe("https://github.com/org/repo/pull/42.diff");
    expect(profile.initialPrompt).toContain("code review");
    expect(profile.initialPrompt).toContain("User can login");
  });
});
```

**Step 2: Run test, verify fail, then implement**

Create `apps/execution/src/planning/smolAgentReviewProfile.ts`:

```ts
export interface SmolAgentReviewProfileInput {
  sessionId: string;
  workItemId: string;
  pullRequestId: string;
  workItemTitle: string;
  prDiffUrl: string;
  requirements: string[];
  taskDescription: string;
  workingDirectory: string;
}

export interface SmolAgentReviewProfile {
  agentType: "smol-agent";
  runPhase: "review";
  initialPrompt: string;
  env: Record<string, string>;
}

export function buildSmolAgentReviewProfile(
  input: SmolAgentReviewProfileInput,
): SmolAgentReviewProfile {
  const requirementsList = input.requirements.length > 0
    ? input.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "No specific requirements listed.";

  const initialPrompt = [
    "You are performing a code review for a Bob-managed task.",
    `Task: ${input.workItemTitle}`,
    "",
    "## Task Description",
    input.taskDescription,
    "",
    "## Requirements to Verify",
    requirementsList,
    "",
    "## Instructions",
    "1. Read the PR diff and the surrounding codebase for context",
    "2. Check that the implementation satisfies each listed requirement",
    "3. Look for bugs, security issues, and code quality problems",
    "4. Produce your review by calling the submit_review tool with:",
    '   - decision: "approve" or "request_changes"',
    "   - summary: one-paragraph overall assessment",
    "   - comments: array of { file, line, comment } for specific feedback",
    "   - requirementsCoverage: object mapping each requirement to true/false",
    "",
    "Be thorough but fair. Only request changes for genuine issues.",
  ].join("\n");

  return {
    agentType: "smol-agent",
    runPhase: "review",
    initialPrompt,
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_PR_ID: input.pullRequestId,
      BOB_PR_DIFF_URL: input.prDiffUrl,
      BOB_RUN_PHASE: "review",
      BOB_WORKTREE_PATH: input.workingDirectory,
    },
  };
}
```

**Step 3: Run test, verify pass, commit**

```bash
pnpm vitest apps/execution/src/planning/__tests__/smolAgentReviewProfile.test.ts
git add apps/execution/src/planning/smolAgentReviewProfile.ts apps/execution/src/planning/__tests__/smolAgentReviewProfile.test.ts
git commit -m "feat: add code-reviewer smol-agent profile"
```

## Task 3: Insert awaiting_review state into pipeline orchestrator

**Files:**
- Modify: `packages/api/src/services/forgegraph/pipelineOrchestrator.ts`
- Modify: `packages/api/src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts`

**Step 1: Update the existing test**

In `pipelineOrchestrator.test.ts`, find the test at line ~96 that asserts `agent_complete → building`. Change it to assert `agent_complete → awaiting_review`.

Add a new test:

```ts
describe("awaiting_review state", () => {
  it("transitions to building when a code_review artifact with approve exists", async () => {
    const item = makeItem({ pipelineState: "awaiting_review" });

    // workItemArtifacts.findFirst → returns approved review
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: "artifact-1",
      artifactType: "code_review",
      isCurrent: true,
      content: JSON.stringify({ decision: "approve" }),
    });

    await advancePipeline(db as any, item, makeBatch());

    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "building" });
  });

  it("stays in awaiting_review when no review artifact exists", async () => {
    const item = makeItem({ pipelineState: "awaiting_review" });
    dbQueryFindFirstMock.mockResolvedValueOnce(null);

    await advancePipeline(db as any, item, makeBatch());

    expect(dbUpdateSetMock).not.toHaveBeenCalled();
  });
});
```

**Step 2: Implement the pipeline changes**

In `pipelineOrchestrator.ts`:

1. Import `workItemArtifacts` from schema
2. Add `"review_failed"` to `TERMINAL_STATES`
3. Update the state machine comment to include `awaiting_review`
4. Add case in switch:
```ts
case "awaiting_review":
  await handleAwaitingReview(db, item, batch);
  break;
```
5. Modify `handleAgentComplete` to transition to `"awaiting_review"` instead of `"building"`
6. Add `handleAwaitingReview`:

```ts
async function handleAwaitingReview(
  db: Database,
  item: PipelineItem,
  batch: PipelineBatch,
): Promise<void> {
  // Check for a current code_review artifact for this task's work item
  const review = await db.query.workItemArtifacts.findFirst({
    where: and(
      eq(workItemArtifacts.artifactType, "code_review"),
      eq(workItemArtifacts.isCurrent, true),
      // Match by the planning task ID (work item)
      eq(workItemArtifacts.workItemId, item.planningTaskId),
    ),
  });

  if (!review?.content) return; // No review yet — wait

  try {
    const parsed = JSON.parse(review.content as string) as { decision: string };

    if (parsed.decision === "approve") {
      // Review passed — trigger build
      await handleAgentComplete_triggerBuild(db, item);
      await setPipelineState(db, item.id, "building");
    } else if (parsed.decision === "request_changes") {
      // Stay in awaiting_review — the execution agent will be resumed
      // with feedback via the request-changes flow (Task 5)
      console.log(
        `[pipeline] Review requested changes for ${item.planningTaskIdentifier}`,
      );
    }
  } catch {
    // Malformed review artifact
    console.error(
      `[pipeline] Failed to parse review artifact for ${item.planningTaskIdentifier}`,
    );
  }
}
```

7. Extract the build-triggering logic from `handleAgentComplete` into a helper `handleAgentComplete_triggerBuild` so it can be reused by `handleAwaitingReview`.

**Step 3: Run tests, verify pass, commit**

```bash
pnpm vitest packages/api/src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts
git add packages/api/src/services/forgegraph/pipelineOrchestrator.ts packages/api/src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts
git commit -m "feat: add awaiting_review state to pipeline orchestrator"
```

## Task 4: Auto-trigger code-reviewer on dispatch in_review

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`

**Step 1: Find the in_review transition**

Search for `"in_review"` in `dispatch.ts`. The dispatch router sets item status and calls `updatePlanningTaskStatus`. After this transition, if a PR exists for the task, start a code-reviewer session.

**Step 2: Add the review trigger**

After the `"in_review"` status update, add:

```ts
// Auto-trigger code reviewer if PR exists
if (item.pullRequestId) {
  void triggerCodeReview(db, item, batch).catch((err) =>
    console.error(`[dispatch] Failed to trigger code review:`, err),
  );
}
```

Create a helper function `triggerCodeReview` that:
1. Looks up the PR and work item
2. Fetches requirements for the work item
3. Builds the review profile using `buildSmolAgentReviewProfile`
4. Starts a gateway session via `gatewayRequest`

**Step 3: Commit**

```bash
git add packages/api/src/router/dispatch.ts
git commit -m "feat: auto-trigger code reviewer on dispatch in_review"
```

## Task 5: Request-changes feedback loop

**Files:**
- Modify: `packages/api/src/router/dispatch.ts` or new helper

**Step 1: Implement**

When a `code_review` artifact with `decision: "request_changes"` is created (via the review agent's tool call), resume the execution agent session with the review comments as context:

```ts
import { resumeBlockedTask } from "@bob/execution/runtime/taskExecutor";

// In the review artifact creation handler:
if (decision === "request_changes" && taskRunId) {
  const message = [
    "Code review requested changes:",
    summary,
    "",
    "Specific comments:",
    ...comments.map((c) => `- ${c.file}:${c.line} — ${c.comment}`),
  ].join("\n");

  await resumeBlockedTask(taskRunId, message);
}
```

Also: mark prior review artifacts as `isCurrent: false` when new commits are pushed (handle in the existing `pull_request.synchronize` webhook).

**Step 2: Commit**

```bash
git add packages/api/src/router/dispatch.ts
git commit -m "feat: request-changes resumes execution agent with review feedback"
```

## Task 6: Feature PR auto-creation

**Files:**
- Modify: `packages/api/src/services/automation/feature-assembly.ts`

**Step 1: Extend checkFeatureReadiness**

After the `allMerged` check succeeds and status is set to `"ready"`, auto-create the feature PR:

```ts
import { createDraftPr } from "../git/prService";

// After setting status to "ready":
try {
  const pr = await createDraftPr({
    repositoryId: branch.repositoryId,
    headBranch: branch.branchName,
    baseBranch: branch.baseBranch,
    title: `Feature: ${branch.branchName}`,
    body: `Auto-created feature PR for work item. All ${taskPRs.length} task PRs merged.`,
    userId: params.userId,
  });

  if (pr) {
    await db
      .update(featureBranches)
      .set({ featurePrId: pr.id })
      .where(eq(featureBranches.id, params.featureBranchId));
  }

  console.log(
    `[feature-assembly] Auto-created feature PR for branch ${branch.branchName}`,
  );
  return { ready: true, featurePrCreated: true };
} catch (err) {
  console.error(`[feature-assembly] Failed to auto-create feature PR:`, err);
  // Don't block readiness — notify human to create manually
  return { ready: true, featurePrCreated: false };
}
```

**Step 2: Commit**

```bash
git add packages/api/src/services/automation/feature-assembly.ts
git commit -m "feat: auto-create feature PR when all task PRs merge"
```

## Task 7: Review webhook handler

**Files:**
- Modify: `packages/api/src/services/webhooks/processWebhook.ts`

**Step 1: Add pull_request_review event handling**

In the webhook processor's event switch, add:

```ts
case "pull_request_review": {
  const review = payload.review as { state: string; body?: string };
  const prNumber = (payload.pull_request as { number: number }).number;

  if (review.state === "approved" || review.state === "changes_requested") {
    // Sync external review to Bob's review tracking
    // Update or create a code_review artifact
    console.log(
      `[webhook] External review ${review.state} for PR #${prNumber}`,
    );
  }
  break;
}
```

**Step 2: Commit**

```bash
git add packages/api/src/services/webhooks/processWebhook.ts
git commit -m "feat: handle pull_request_review webhook for external reviews"
```

## Task 8: UI review status and merge gating

**Files:**
- Create: `apps/web/src/components/pr/review-status-badge.tsx`
- Modify: PR detail page to show badge and gate merge button

**Step 1: Create the ReviewStatusBadge component**

```tsx
"use client";

interface ReviewStatusBadgeProps {
  status: "pending" | "approved" | "changes_requested" | "failed" | null;
}

const STATUS_STYLES = {
  pending: "bg-[#E3E1DC] text-[#8A877E] dark:bg-[#232220] dark:text-[#6E6B64]",
  approved: "bg-[#E8F5E9] text-[#2D8A4E] dark:bg-[#1B2E1D] dark:text-[#4CAF50]",
  changes_requested: "bg-[#FFF3E0] text-[#D4850A] dark:bg-[#2C2418] dark:text-[#E8A33C]",
  failed: "bg-[#FFEBEE] text-[#C62828] dark:bg-[#2E1616] dark:text-[#EF5350]",
} as const;

const STATUS_LABELS = {
  pending: "AWAITING REVIEW",
  approved: "APPROVED",
  changes_requested: "CHANGES REQUESTED",
  failed: "REVIEW FAILED",
} as const;

export function ReviewStatusBadge({ status }: ReviewStatusBadgeProps) {
  if (!status) return null;

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold tracking-[0.04em] uppercase ${STATUS_STYLES[status]}`}
      role="status"
      aria-label={`Review status: ${STATUS_LABELS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/pr/review-status-badge.tsx
git commit -m "feat: add ReviewStatusBadge component with DESIGN.md tokens"
```

## Task 9: Full verification

**Step 1: Run all Phase 3 tests**

```bash
pnpm vitest apps/execution/src/planning/__tests__/smolAgentReviewProfile.test.ts packages/api/src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts
```

**Step 2: Run regression suite**

```bash
pnpm vitest packages/api/src/router/__tests__/planSession.test.ts packages/api/src/router/__tests__/commitPlanLocal.test.ts apps/execution/src/planning/__tests__/smolAgentPlanningProfile.test.ts apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts apps/execution/src/runtime/smolAgentProfile.test.ts
```

**Step 3: Type check all packages**

```bash
npx turbo build --filter=@bob/db && npx tsc --noEmit --project packages/api/tsconfig.json && npx tsc --noEmit --project apps/execution/tsconfig.json
```

## Notes

- `handleAgentComplete` now transitions to `awaiting_review` — the existing build trigger logic is extracted into `handleAgentComplete_triggerBuild` and called by `handleAwaitingReview` after approval
- In-flight items already in `agent_complete` when this deploys will see the new path on next poll — they'll go to `awaiting_review` first
- The code-reviewer timeout (5 min) should be handled by the same mechanism as the planning session timeout — a `setTimeout` on the gateway session
- `review_failed` is added to `TERMINAL_STATES` alongside `build_failed` and `deploy_failed`
