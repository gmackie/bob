# Planning Pipeline UX — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing 7-stage workflow pipeline with planning-session awareness — split-view sessions, artifact linking, context chaining, session replay, task tree editor, and stage badges.

**Architecture:** Extend existing `chatConversations` with `planningSessionType`, add `content` column to `workItemArtifacts` for inline markdown storage. New split-view route at `/work-items/[id]/plan/[sid]` embeds existing ChatPanel (left) + new ArtifactPreviewPanel (right) with resizable divider. Task tree editor reuses `planDrafts` model, commitPlan writes local `workItems` with `parentId` hierarchy.

**Tech Stack:** Next.js App Router, tRPC, Drizzle ORM, React Query, dnd-kit (task tree), existing ChatPanel + UI components

**Design System:** All new components calibrated against DESIGN.md — warm amber primary (#D4850A), Satoshi/DM Sans fonts, 4px spacing base, rounded-3xl cards, emerald for completed states.

**Key Decisions (from CEO + Eng + Design reviews):**
- Extend existing 7-stage pipeline, don't replace
- Split-view is canonical planning surface (replaces ChatPanel for planning)
- Artifact content stored inline (content column, not URLs)
- New `planningSessionType` column (additive, no migration needed for existing data)
- Task hierarchy preserved in local DB via `parentId`
- Stage detection stays durable (no draft-based detection)
- Mobile: tab-based collapse (Chat/Artifact tabs)
- Resizable divider: min 25%, max 75%, stored in localStorage
- Finish session: header link always + primary CTA after 5+ messages

---

## Phase 1: Schema & API Foundation

### Task 1: Add `planningSessionType` column to chatConversations

**Files:**
- Create: `packages/db/drizzle/0008_planning_session_type.sql`
- Modify: `packages/db/src/schema.ts:789-838`

**Step 1: Write the migration SQL**

```sql
-- 0008_planning_session_type.sql
ALTER TABLE chat_conversations
  ADD COLUMN planning_session_type VARCHAR(30);

COMMENT ON COLUMN chat_conversations.planning_session_type IS
  'Fine-grained type for planning sessions: office_hours, ceo_review, eng_review, design_review, breakdown. Null for non-planning sessions.';
```

**Step 2: Add column to Drizzle schema**

In `packages/db/src/schema.ts`, inside the `chatConversations` table definition (after line ~825, after `awaitingInputResolution`), add:

```typescript
planningSessionType: t.varchar({ length: 30 }),
// values: "office_hours" | "ceo_review" | "eng_review" | "design_review" | "breakdown"
```

**Step 3: Run migration**

```bash
cd packages/db && pnpm drizzle-kit push
```

**Step 4: Commit**

```bash
git add packages/db/drizzle/0008_planning_session_type.sql packages/db/src/schema.ts
git commit -m "feat(schema): add planningSessionType column to chatConversations"
```

---

### Task 2: Add `content` column to workItemArtifacts + `planning_doc` artifact type

**Files:**
- Create: `packages/db/drizzle/0009_artifact_content.sql`
- Modify: `packages/db/src/schema.ts:116-129` (workItemArtifactType enum)
- Modify: `packages/db/src/schema.ts:1603-1635` (workItemArtifacts table + schema)

**Step 1: Write the migration SQL**

```sql
-- 0009_artifact_content.sql
ALTER TYPE work_item_artifact_type ADD VALUE IF NOT EXISTS 'planning_doc';

ALTER TABLE work_item_artifacts
  ADD COLUMN content TEXT,
  ADD COLUMN session_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL;

-- Allow URL to be nullable for content-based artifacts
ALTER TABLE work_item_artifacts
  ALTER COLUMN url DROP NOT NULL;
```

**Step 2: Update Drizzle schema**

In `packages/db/src/schema.ts`:

a) Add `"planning_doc"` to the `workItemArtifactType` array (line ~116):
```typescript
export const workItemArtifactType = [
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "planning_doc",
  "other",
] as const;
```

b) Add `content` and `sessionId` columns to `workItemArtifacts` (after line ~1617):
```typescript
content: t.text(),
sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
```

c) Make `url` nullable in the table definition (line ~1614):
```typescript
url: t.text(), // was: t.text().notNull()
```

d) Update `CreateWorkItemArtifactSchema` to make `url` optional and add `content`:
```typescript
export const CreateWorkItemArtifactSchema = createInsertSchema(
  workItemArtifacts,
  {
    producerType: z.enum(workItemArtifactProducerType),
    artifactType: z.enum(workItemArtifactType),
    artifactRole: z.string().min(1),
    url: z.string().url().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
  },
).omit({
  id: true,
  createdAt: true,
});
```

**Step 3: Add `planning_session_completed` to activity type enum**

In `packages/db/src/schema.ts`, update `workItemActivityType` (line ~87):
```typescript
export const workItemActivityType = [
  "comment_added",
  "status_changed",
  "artifact_added",
  "notification_created",
  "build_status_changed",
  "deploy_status_changed",
  "planning_session_completed",
] as const;
```

And add the migration SQL to `0009_artifact_content.sql`:
```sql
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'planning_session_completed';
```

**Step 4: Run migration and commit**

```bash
cd packages/db && pnpm drizzle-kit push
git add packages/db/
git commit -m "feat(schema): add content column to artifacts + planning_doc type + session activity"
```

---

### Task 3: Extend planSession router — `listByWorkItem` + `planningSessionType` support

**Files:**
- Modify: `packages/api/src/router/planSession.ts`

**Step 1: Update `create` mutation to accept `planningSessionType`**

In the `create` mutation input schema (around line 52), add:
```typescript
planningSessionType: z.enum([
  "office_hours",
  "ceo_review",
  "eng_review",
  "design_review",
  "breakdown",
]).optional(),
```

In the `insert` values (around line 80), add:
```typescript
planningSessionType: input.planningSessionType ?? null,
```

**Step 2: Add `listByWorkItem` query**

After the `list` query (around line 175), add:
```typescript
/** List planning sessions for a specific work item. */
listByWorkItem: protectedProcedure
  .input(
    z.object({
      workItemId: z.string().uuid(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const sessions = await ctx.db.query.chatConversations.findMany({
      where: and(
        eq(chatConversations.userId, ctx.session.user.id),
        eq(chatConversations.sessionType, "planning"),
        eq(chatConversations.workItemId, input.workItemId),
      ),
      orderBy: desc(chatConversations.createdAt),
    });

    return sessions;
  }),

/** Check if there's an active planning session for a work item. */
getActiveForWorkItem: protectedProcedure
  .input(z.object({ workItemId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const active = await ctx.db.query.chatConversations.findFirst({
      where: and(
        eq(chatConversations.userId, ctx.session.user.id),
        eq(chatConversations.sessionType, "planning"),
        eq(chatConversations.workItemId, input.workItemId),
        // Active = not stopped/completed
        inArray(chatConversations.status, [
          "provisioning",
          "running",
          "active",
          "starting",
        ]),
      ),
      orderBy: desc(chatConversations.createdAt),
    });

    return active ?? null;
  }),
```

**Step 3: Add `saveArtifact` mutation**

After the `commitPlan` mutation, add:
```typescript
/** Save a planning artifact (design doc, plan, etc.) to the work item. */
saveArtifact: protectedProcedure
  .input(
    z.object({
      sessionId: z.string().uuid(),
      workItemId: z.string().uuid(),
      title: z.string().min(1).max(256),
      content: z.string().min(1),
      planningSessionType: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Save artifact with inline content
    const [artifact] = await ctx.db
      .insert(workItemArtifacts)
      .values({
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        producerType: "bob",
        producerId: input.sessionId,
        artifactType: "planning_doc",
        artifactRole: input.planningSessionType ?? "planning_doc",
        title: input.title,
        content: input.content,
        isCurrent: true,
      })
      .returning();

    // Create activity record
    await ctx.db.insert(workItemActivities).values({
      workItemId: input.workItemId,
      actorId: ctx.session.user.id,
      type: "planning_session_completed",
      metadata: {
        sessionId: input.sessionId,
        artifactId: artifact!.id,
        sessionType: input.planningSessionType,
        title: input.title,
      },
    });

    return artifact!;
  }),
```

Note: You'll need to import `workItemArtifacts` and `workItemActivities` from the schema at the top of the file (check if `workItemActivities` exists — if not, use the activities/comment infrastructure that exists).

**Step 4: Commit**

```bash
git add packages/api/src/router/planSession.ts
git commit -m "feat(api): extend planSession router with listByWorkItem, activeSession, saveArtifact"
```

---

### Task 4: Context chaining query — fetch prior artifacts for a work item

**Files:**
- Modify: `packages/api/src/router/planSession.ts`

**Step 1: Add `getPriorContext` query**

```typescript
/** Get prior planning artifacts for context chaining into new sessions. */
getPriorContext: protectedProcedure
  .input(
    z.object({
      workItemId: z.string().uuid(),
      excludeSessionId: z.string().uuid().optional(),
      maxChars: z.number().int().default(8000),
    }),
  )
  .query(async ({ ctx, input }) => {
    const artifacts = await ctx.db.query.workItemArtifacts.findMany({
      where: and(
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.artifactType, "planning_doc"),
        eq(workItemArtifacts.isCurrent, true),
      ),
      orderBy: workItemArtifacts.createdAt,
    });

    // Filter out current session's artifacts if specified
    const filtered = input.excludeSessionId
      ? artifacts.filter((a) => a.sessionId !== input.excludeSessionId)
      : artifacts;

    // Truncate each artifact to fit within budget
    const perArtifactLimit = Math.floor(input.maxChars / Math.max(filtered.length, 1));

    return filtered.map((a) => ({
      id: a.id,
      title: a.title,
      sessionId: a.sessionId,
      content: a.content
        ? a.content.length > perArtifactLimit
          ? a.content.slice(0, perArtifactLimit) + "\n\n[... truncated for context ...]"
          : a.content
        : null,
      createdAt: a.createdAt,
    }));
  }),
```

**Step 2: Commit**

```bash
git add packages/api/src/router/planSession.ts
git commit -m "feat(api): add getPriorContext query for artifact context chaining"
```

---

## Phase 2: Split-View Planning Session

### Task 5: Resizable split-view layout component

**Files:**
- Create: `apps/web/src/components/planning/resizable-split-view.tsx`

**Step 1: Create the resizable split-view component**

This is a reusable layout component with a draggable divider between left and right panels.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@bob/ui";

interface ResizableSplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  storageKey?: string;
  defaultRatio?: number; // 0-1, default 0.6 (60% left)
  minRatio?: number; // default 0.25
  maxRatio?: number; // default 0.75
  className?: string;
}

export function ResizableSplitView({
  left,
  right,
  storageKey = "split-view-ratio",
  defaultRatio = 0.6,
  minRatio = 0.25,
  maxRatio = 0.75,
  className,
}: ResizableSplitViewProps) {
  const [ratio, setRatio] = useState(() => {
    if (typeof window === "undefined") return defaultRatio;
    const stored = localStorage.getItem(storageKey);
    return stored ? Math.min(maxRatio, Math.max(minRatio, parseFloat(stored))) : defaultRatio;
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = Math.min(maxRatio, Math.max(minRatio, (e.clientX - rect.left) / rect.width));
      setRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(storageKey, ratio.toString());
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, maxRatio, minRatio, ratio, storageKey]);

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full", isDragging && "select-none", className)}
    >
      {/* Left panel */}
      <div
        role="region"
        aria-label="Chat"
        className="flex flex-col overflow-hidden"
        style={{ width: `${ratio * 100}%` }}
      >
        {left}
      </div>

      {/* Resizable divider */}
      <div
        role="separator"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-orientation="vertical"
        tabIndex={0}
        className={cn(
          "relative w-1 cursor-col-resize flex-shrink-0 transition-colors",
          isDragging ? "bg-primary" : "bg-border hover:bg-primary/30",
        )}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setRatio((r) => Math.max(minRatio, r - 0.01));
          if (e.key === "ArrowRight") setRatio((r) => Math.min(maxRatio, r + 0.01));
        }}
      >
        {/* Grip dots */}
        <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 flex-col items-center justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div
        role="region"
        aria-label="Artifact preview"
        className="flex flex-1 flex-col overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/planning/resizable-split-view.tsx
git commit -m "feat(ui): resizable split-view layout component with localStorage persistence"
```

---

### Task 6: Artifact preview panel component

**Files:**
- Create: `apps/web/src/components/planning/artifact-preview-panel.tsx`

**Step 1: Create the artifact preview panel**

This renders markdown content in real-time as it's extracted from the chat stream, plus shows prior artifacts in tabs.

```tsx
"use client";

import { useState } from "react";
import { cn } from "@bob/ui";

interface ArtifactPreviewPanelProps {
  /** Live content being built during the session */
  liveContent: string | null;
  /** Prior artifacts for context */
  priorArtifacts: Array<{
    id: string;
    title: string | null;
    content: string | null;
    createdAt: string;
  }>;
  /** Whether the session is still active (enables editing after completion) */
  isSessionActive: boolean;
  /** Called when user edits the artifact content post-session */
  onContentEdit?: (content: string) => void;
  className?: string;
}

export function ArtifactPreviewPanel({
  liveContent,
  priorArtifacts,
  isSessionActive,
  onContentEdit,
  className,
}: ArtifactPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<"live" | string>("live");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const hasTabs = priorArtifacts.length > 0;
  const displayContent = activeTab === "live"
    ? liveContent
    : priorArtifacts.find((a) => a.id === activeTab)?.content;

  return (
    <div className={cn("flex h-full flex-col bg-card", className)}>
      {/* Tabs (if prior artifacts exist) */}
      {hasTabs && (
        <div className="flex items-center gap-1 border-b border-border px-4 pt-3 pb-0">
          <button
            onClick={() => setActiveTab("live")}
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
              activeTab === "live"
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Current Session
          </button>
          {priorArtifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setActiveTab(a.id)}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors truncate max-w-[200px]",
                activeTab === a.id
                  ? "bg-background text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.title ?? "Artifact"}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!displayContent ? (
          /* Empty / waiting state */
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <svg className="h-8 w-8 text-primary animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              Bob is thinking...
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The artifact will appear here as it takes shape.
            </p>
          </div>
        ) : isEditing ? (
          /* Edit mode */
          <div className="h-full">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="h-full w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        ) : (
          /* Rendered markdown */
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {/* Use a simple pre-formatted display for now; replace with proper markdown renderer */}
            <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {displayContent}
            </div>
          </div>
        )}
      </div>

      {/* Footer — edit toggle (only after session completes) */}
      {!isSessionActive && displayContent && activeTab === "live" && (
        <div className="border-t border-border px-4 py-2 flex items-center justify-end gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => { setIsEditing(false); }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onContentEdit?.(editContent);
                  setIsEditing(false);
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
              >
                Save changes
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setEditContent(displayContent);
                setIsEditing(true);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Edit artifact
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/planning/artifact-preview-panel.tsx
git commit -m "feat(ui): artifact preview panel with live content, tabs, and edit mode"
```

---

### Task 7: Split-view planning session page

**Files:**
- Create: `apps/web/src/app/(dashboard)/work-items/[workItemId]/plan/[sessionId]/page.tsx`

**Step 1: Create the split-view route**

This is the main planning session page. It loads the session, work item context, and prior artifacts, then renders the split-view with ChatPanel on the left and ArtifactPreviewPanel on the right.

```tsx
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { createPlanningCaller } from "~/lib/planning/server";
import { PlanningSessionClient } from "./planning-session-client";

interface PlanningSessionPageProps {
  params: Promise<{ workItemId: string; sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function PlanningSessionPage({ params }: PlanningSessionPageProps) {
  const { workItemId, sessionId } = await params;
  const caller = (await createPlanningCaller()) as any;

  // Fetch work item and session in parallel
  const [workItemDetail, sessionData, priorArtifacts] = await Promise.all([
    caller.workItem.get({ id: workItemId }).catch(() => null),
    caller.planSession.get({ sessionId }).catch(() => null),
    caller.planSession.getPriorContext({ workItemId, excludeSessionId: sessionId }).catch(() => []),
  ]);

  if (!workItemDetail) {
    notFound();
  }

  if (!sessionData?.session) {
    // Session not found — redirect to work item
    redirect(`/work-items/${workItemId}`);
  }

  const workItem = workItemDetail.workItem;
  const session = sessionData.session;
  const isReadOnly = session.status === "stopped" || session.status === "completed";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-border bg-background px-6 py-3">
        <Breadcrumbs
          items={[
            { label: "Planning", href: "/planning" },
            ...(workItem.project
              ? [{ label: workItem.project.key, href: `/projects/${workItem.project.id}` }]
              : []),
            { label: workItem.identifier, href: `/work-items/${workItemId}` },
            { label: session.planningSessionType
              ? formatSessionType(session.planningSessionType)
              : "Planning Session" },
          ]}
        />

        {/* Stage badge */}
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {session.planningSessionType
            ? formatSessionType(session.planningSessionType)
            : "Planning"}
        </span>

        {/* End session link (always visible) */}
        {!isReadOnly && (
          <button className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            End session
          </button>
        )}

        {isReadOnly && (
          <span className="ml-auto text-xs text-muted-foreground">
            Read-only replay
          </span>
        )}
      </div>

      {/* Split-view body */}
      <PlanningSessionClient
        workItem={{
          id: workItem.id,
          identifier: workItem.identifier,
          title: workItem.title,
          description: workItem.description ?? null,
          projectId: workItem.project?.id ?? null,
          projectName: workItem.project?.name ?? null,
          workspaceId: workItem.workspaceId,
        }}
        session={{
          id: session.id,
          status: session.status,
          planningSessionType: session.planningSessionType,
        }}
        priorArtifacts={priorArtifacts}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

function formatSessionType(type: string): string {
  const map: Record<string, string> = {
    office_hours: "Office Hours",
    ceo_review: "CEO Review",
    eng_review: "Eng Review",
    design_review: "Design Review",
    breakdown: "Breakdown",
  };
  return map[type] ?? type;
}
```

**Step 2: Create the client component**

Create `apps/web/src/app/(dashboard)/work-items/[workItemId]/plan/[sessionId]/planning-session-client.tsx`:

This component wires up the ResizableSplitView with the ChatPanel and ArtifactPreviewPanel. For the initial implementation, the artifact content extraction from the chat stream can be a simple heuristic — look for the last large markdown block in the assistant's messages.

```tsx
"use client";

import { useState, useCallback } from "react";

import { ResizableSplitView } from "~/components/planning/resizable-split-view";
import { ArtifactPreviewPanel } from "~/components/planning/artifact-preview-panel";
import { useChatPanel } from "~/components/chat/chat-panel-provider";
// Import or inline a lightweight chat component that embeds in the split view
// For v1, we can use the existing ChatPanel mechanism

interface PlanningSessionClientProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    projectId: string | null;
    projectName: string | null;
    workspaceId: string;
  };
  session: {
    id: string;
    status: string;
    planningSessionType: string | null;
  };
  priorArtifacts: Array<{
    id: string;
    title: string | null;
    content: string | null;
    createdAt: string;
  }>;
  isReadOnly: boolean;
}

export function PlanningSessionClient({
  workItem,
  session,
  priorArtifacts,
  isReadOnly,
}: PlanningSessionClientProps) {
  const [artifactContent, setArtifactContent] = useState<string | null>(null);

  // TODO: Wire up to actual chat messages stream
  // For v1, the chat panel component will need to expose a callback
  // that fires when new messages arrive, allowing us to parse artifact content.

  return (
    <div className="flex-1 overflow-hidden">
      {/* Desktop: split view */}
      <div className="hidden h-full md:block">
        <ResizableSplitView
          storageKey={`planning-split-${workItem.id}`}
          left={
            <div className="flex h-full flex-col bg-background p-4">
              {/* Chat panel placeholder — will be wired to existing ChatPanel */}
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Chat panel will be embedded here.
                <br />
                Session: {session.id}
              </div>
            </div>
          }
          right={
            <ArtifactPreviewPanel
              liveContent={artifactContent}
              priorArtifacts={priorArtifacts}
              isSessionActive={!isReadOnly}
            />
          }
        />
      </div>

      {/* Mobile: tab view */}
      <div className="flex h-full flex-col md:hidden">
        <MobilePlanningTabs
          artifactContent={artifactContent}
          priorArtifacts={priorArtifacts}
          isReadOnly={isReadOnly}
          sessionId={session.id}
        />
      </div>
    </div>
  );
}

function MobilePlanningTabs({
  artifactContent,
  priorArtifacts,
  isReadOnly,
  sessionId,
}: {
  artifactContent: string | null;
  priorArtifacts: Array<{ id: string; title: string | null; content: string | null; createdAt: string }>;
  isReadOnly: boolean;
  sessionId: string;
}) {
  const [tab, setTab] = useState<"chat" | "artifact">("chat");

  return (
    <>
      <div className="flex border-b border-border">
        {(["chat", "artifact"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            {t === "chat" ? "Chat" : "Artifact"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "chat" ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm p-4">
            Chat panel (mobile)
          </div>
        ) : (
          <ArtifactPreviewPanel
            liveContent={artifactContent}
            priorArtifacts={priorArtifacts}
            isSessionActive={!isReadOnly}
          />
        )}
      </div>
    </>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/work-items/[workItemId]/plan/
git commit -m "feat(ui): split-view planning session route with header, mobile tabs, and artifact preview"
```

---

## Phase 3: Stage Section Enhancements

### Task 8: Session history component for stage sections

**Files:**
- Create: `apps/web/src/components/workflow/session-history.tsx`

**Step 1: Create the session history component**

This renders a list of planning sessions that have been run in a particular stage, with links to replay and view artifacts.

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { cn } from "@bob/ui";
import { useTRPC } from "~/trpc/react";

const SESSION_TYPE_ICONS: Record<string, string> = {
  office_hours: "pencil",
  ceo_review: "megaphone",
  eng_review: "wrench",
  design_review: "palette",
  breakdown: "blocks",
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  office_hours: "Office Hours",
  ceo_review: "CEO Review",
  eng_review: "Eng Review",
  design_review: "Design Review",
  breakdown: "Breakdown",
};

interface SessionHistoryProps {
  workItemId: string;
  /** Filter to only show sessions of certain types */
  sessionTypes?: string[];
  className?: string;
}

export function SessionHistory({
  workItemId,
  sessionTypes,
  className,
}: SessionHistoryProps) {
  const trpc = useTRPC();

  const { data: sessions, isLoading } = useQuery(
    trpc.planSession.listByWorkItem.queryOptions(
      { workItemId },
      { staleTime: 15_000 },
    ),
  );

  const filtered = sessionTypes
    ? (sessions ?? []).filter((s: any) => sessionTypes.includes(s.planningSessionType))
    : (sessions ?? []);

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        {[0, 1].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border border-border p-3">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="mt-2 h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return null; // Don't render empty section — let parent handle empty state
  }

  return (
    <div className={cn("space-y-2", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sessions
      </h3>
      {filtered.map((session: any) => (
        <div
          key={session.id}
          className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
        >
          {/* Session type icon placeholder */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <SessionTypeIcon type={session.planningSessionType} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {SESSION_TYPE_LABELS[session.planningSessionType] ?? "Planning Session"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeDate(session.createdAt)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link
              href={`/work-items/${workItemId}/plan/${session.id}`}
              className="text-xs text-primary hover:underline"
            >
              {session.status === "stopped" ? "Replay" : "Resume"}
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionTypeIcon({ type }: { type: string | null }) {
  // Simple SVG icons for each session type
  // Using inline SVGs to avoid icon library dependency
  switch (type) {
    case "office_hours":
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
        </svg>
      );
    case "ceo_review":
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
        </svg>
      );
    case "eng_review":
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
        </svg>
      );
    case "design_review":
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
        </svg>
      );
  }
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/workflow/session-history.tsx
git commit -m "feat(ui): session history component with type icons and relative dates"
```

---

### Task 9: Enhance StageShape and StagePlan with session history

**Files:**
- Modify: `apps/web/src/components/workflow/stage-shape.tsx`
- Modify: `apps/web/src/components/workflow/stage-plan.tsx`

**Step 1: Add session history to StageShape**

In `stage-shape.tsx`, add the SessionHistory component below the RequirementsChecklist. Import `SessionHistory` and add it inside the content area:

```tsx
// Add import at top:
import { SessionHistory } from "./session-history";

// Inside the !isCollapsed content div, after the checklist, add:
<SessionHistory
  workItemId={workItemId}
  sessionTypes={["office_hours"]}
  className="mt-4"
/>
```

**Step 2: Add session history + launch session to StagePlan**

Read the current `stage-plan.tsx` and add:
- SessionHistory component showing `ceo_review`, `eng_review`, `design_review`, `breakdown` sessions
- A "Launch session" dropdown button with session type options

The launch session button should navigate to the split-view route when clicked:
```tsx
// Navigation helper:
import { useRouter } from "next/navigation";

// In the launch handler:
const router = useRouter();
// After creating the session via planSession.create:
router.push(`/work-items/${workItemId}/plan/${newSession.id}`);
```

**Step 3: Commit**

```bash
git add apps/web/src/components/workflow/stage-shape.tsx apps/web/src/components/workflow/stage-plan.tsx
git commit -m "feat(ui): add session history and launch actions to Shape and Plan stage sections"
```

---

### Task 10: Update WorkflowPageClient to redirect planning sessions to split-view

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workflow-page-client.tsx`

**Step 1: Replace ChatPanel launch with split-view navigation**

In `workflow-page-client.tsx`, change the `onConfirm` handler in `WorkflowLaunchDialog` to navigate to the split-view instead of opening the ChatPanel:

```tsx
// Add import:
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

// Inside the component:
const router = useRouter();
const trpc = useTRPC();
const createSession = useMutation(
  trpc.planSession.create.mutationOptions(),
);

// Replace the onConfirm handler:
onConfirm={(launchContext) => {
  if (!workItem.project?.id) {
    toast("This workflow needs a project-linked work item to start planning.");
    return;
  }

  // Check for active session first
  // If found, navigate to it. If not, create new and navigate.
  createSession.mutate(
    {
      workItemId: workItem.id,
      workspaceId,
      projectId: workItem.project.id,
      title: launchContext.intent === "shape"
        ? `Shape ${workItem.title}`
        : `Plan ${workItem.title}`,
      planningSessionType: launchContext.intent === "shape"
        ? "office_hours"
        : "breakdown",
    },
    {
      onSuccess: (session) => {
        router.push(`/work-items/${workItem.id}/plan/${session.id}`);
      },
    },
  );
  setLaunchIntent(null);
}}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/work-items/[workItemId]/workflow-page-client.tsx
git commit -m "feat(workflow): redirect planning sessions to split-view instead of ChatPanel"
```

---

## Phase 4: Task Tree Editor

### Task 11: Interactive task tree editor component

**Files:**
- Create: `apps/web/src/components/planning/task-tree-editor.tsx`

This is a significant component. Install `@dnd-kit/core` and `@dnd-kit/sortable` if not already in the web app's dependencies.

```bash
cd apps/web && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

The task tree editor should:
- Display draft tasks in a hierarchical tree (epics → tasks)
- Allow inline title editing (click to edit)
- Drag to reorder (within same level) and re-parent (drag onto an epic)
- Add task button
- Delete task button
- Dependency management (add dependency between tasks, with circular dependency validation)
- "Commit tasks" button that calls a new commitPlanWithHierarchy mutation

Due to the complexity of this component, the implementation should be incremental:

**Step 1:** Basic flat list with add/edit/delete (extend existing DraftPanel)
**Step 2:** Add hierarchical rendering with indent levels
**Step 3:** Add drag-and-drop for reorder and re-parent
**Step 4:** Add dependency management with circular validation
**Step 5:** Wire up commit with parentId hierarchy

For detailed code, reference the existing `draft-panel.tsx` component and the `@dnd-kit` documentation. The key architectural decisions:
- Use `planDrafts` as the data model (existing)
- Add a `parentDraftId` field to planDrafts for tree hierarchy (new migration)
- Render with recursive components, 24px indent per level (DESIGN.md lg spacing)
- Drag handles in amber, dependency lines in emerald (matching pipeline colors)

**Commit after each step:**

```bash
git commit -m "feat(ui): task tree editor - step N of 5"
```

---

### Task 12: Enhanced commitPlan mutation with local hierarchy

**Files:**
- Modify: `packages/api/src/router/planSession.ts`

**Step 1: Add commitPlanWithHierarchy mutation**

This creates local work items (in Bob's DB) with parent-child relationships preserved, instead of flat remote issues.

```typescript
/** Commit drafts as local work items with hierarchy preserved. */
commitPlanLocal: protectedProcedure
  .input(z.object({
    sessionId: z.string().uuid(),
    parentWorkItemId: z.string().uuid(),
  }))
  .mutation(async ({ ctx, input }) => {
    const drafts = await ctx.db.query.planDrafts.findMany({
      where: and(
        eq(planDrafts.sessionId, input.sessionId),
        eq(planDrafts.status, "draft"),
      ),
      orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
    });

    if (drafts.length === 0) {
      return { committed: 0, workItems: [] };
    }

    // Get parent work item for workspace/project context
    const parentWI = await ctx.db.query.workItems.findFirst({
      where: eq(workItems.id, input.parentWorkItemId),
    });
    if (!parentWI) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Parent work item not found" });
    }

    // Create work items in order, mapping draft IDs to work item IDs
    const draftToWorkItem = new Map<string, string>();
    const created: Array<{ draftId: string; workItemId: string; title: string }> = [];

    // First pass: create epics (drafts with no parent)
    // Second pass: create tasks under their epics
    // (Simple: treat kind=epic as parents, kind=task as children)
    const epics = drafts.filter((d) => d.kind === "epic");
    const tasks = drafts.filter((d) => d.kind === "task");

    for (const draft of epics) {
      const [wi] = await ctx.db.insert(workItems).values({
        ownerUserId: ctx.session.user.id,
        workspaceId: parentWI.workspaceId,
        projectId: parentWI.projectId,
        parentId: input.parentWorkItemId,
        kind: "epic",
        title: draft.title,
        description: draft.description,
        status: "todo",
      }).returning();
      draftToWorkItem.set(draft.id, wi!.id);
      created.push({ draftId: draft.id, workItemId: wi!.id, title: draft.title });
    }

    for (const draft of tasks) {
      // TODO: When parentDraftId is added to planDrafts, look up the parent epic's work item ID
      // For now, tasks go directly under the parent work item
      const [wi] = await ctx.db.insert(workItems).values({
        ownerUserId: ctx.session.user.id,
        workspaceId: parentWI.workspaceId,
        projectId: parentWI.projectId,
        parentId: input.parentWorkItemId,
        kind: "task",
        title: draft.title,
        description: draft.description,
        status: "todo",
      }).returning();
      draftToWorkItem.set(draft.id, wi!.id);
      created.push({ draftId: draft.id, workItemId: wi!.id, title: draft.title });
    }

    // Mark all as committed
    const committedIds = created.map((c) => c.draftId);
    if (committedIds.length > 0) {
      await ctx.db
        .update(planDrafts)
        .set({ status: "committed" })
        .where(inArray(planDrafts.id, committedIds));
    }

    return { committed: created.length, workItems: created };
  }),
```

**Step 2: Commit**

```bash
git add packages/api/src/router/planSession.ts
git commit -m "feat(api): commitPlanLocal mutation with parent-child hierarchy in local DB"
```

---

## Phase 5: Stage Badges & Entry Points

### Task 13: Stage badges on project issue lists

**Files:**
- Modify: `packages/api/src/router/workItems.ts` (or the `planning` router's `listTasks`)
- Modify: `apps/web/src/components/projects/project-detail-tabs.tsx`

**Step 1: Add aggregate query with stage detection inputs**

Extend the work item list query to include child count, requirement count, and dispatched count as aggregated subqueries in a single SQL join. This avoids N+1 queries.

**Step 2: Create a StageBadge component**

```tsx
// apps/web/src/components/workflow/stage-badge.tsx
import { cn } from "@bob/ui";
import { detectStage, type StageDetectionInput } from "~/lib/workflow/stage";

interface StageBadgeProps {
  stageInput: StageDetectionInput;
  className?: string;
}

export function StageBadge({ stageInput, className }: StageBadgeProps) {
  const { stage } = detectStage(stageInput);

  const colors: Record<string, string> = {
    idea: "bg-muted text-muted-foreground",
    shape: "bg-primary/10 text-primary",
    plan: "bg-primary/10 text-primary",
    execute: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    review: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    deploy: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    live: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  };

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        colors[stage] ?? colors.idea,
        className,
      )}
      aria-label={`Stage: ${stage}`}
    >
      {stage.charAt(0).toUpperCase() + stage.slice(1)}
    </span>
  );
}
```

**Step 3: Add badge to project issue list items and "Needs Planning" filter**

**Step 4: Commit**

```bash
git add apps/web/src/components/workflow/stage-badge.tsx apps/web/src/components/projects/ packages/api/
git commit -m "feat(ui): stage badges on project issue lists with batch aggregate query"
```

---

### Task 14: "New Idea" quick-create button

**Files:**
- Modify: `apps/web/src/app/(dashboard)/planning/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`

**Step 1: Add a "New Idea" button** that creates a stub work item (just a title) and immediately navigates to the split-view to start the first planning session.

The button opens a minimal dialog: just a title input + optional project selector. On submit:
1. Creates a work item via `workItem.create` with kind `"issue"`, status `"draft"`, minimal title
2. Creates a planning session via `planSession.create` with `planningSessionType: "office_hours"`
3. Navigates to `/work-items/[newWorkItemId]/plan/[newSessionId]`

**Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/planning/ apps/web/src/app/(dashboard)/projects/
git commit -m "feat(ui): New Idea quick-create button on planning and project pages"
```

---

### Task 15: Review page redirect

**Files:**
- Modify: `apps/web/src/app/(dashboard)/planning/review/[sessionId]/page.tsx`

**Step 1: Add redirect logic**

At the top of the page component, check if the session has a `workItemId`. If so, redirect to the split-view:

```tsx
// After fetching session data:
if (session.workItemId) {
  redirect(`/work-items/${session.workItemId}/plan/${sessionId}`);
}
// Otherwise, render the existing DraftPanel page
```

**Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/planning/review/
git commit -m "feat(routing): redirect review page to split-view for work-item-linked sessions"
```

---

## Phase 6: Integration & Polish

### Task 16: Wire ChatPanel into split-view

This task integrates the actual chat functionality into the split-view's left panel. The existing ChatPanel or session mechanism needs to be embedded in the split-view layout rather than opening as a slide-out.

This is the most integration-heavy task and depends on the existing ChatPanel architecture. Key approach:
- Extract the core chat functionality from `ChatPanel` into a reusable `ChatView` component
- Embed `ChatView` in the split-view's left panel
- Wire up message events to update the artifact preview panel

**Commit:**
```bash
git commit -m "feat(planning): wire chat into split-view with artifact content extraction"
```

---

### Task 17: Structured artifact events from gateway

Add gateway-side event emission for artifact updates. When the planning session produces a recognizable artifact (design doc, plan, task list), the gateway emits an `artifact_update` event that the split-view can subscribe to.

This supplements the chat-stream parsing (approach A) with a robust event source (approach B).

**Commit:**
```bash
git commit -m "feat(gateway): structured artifact_update events for planning sessions"
```

---

### Task 18: End-to-end testing

Write integration tests covering the critical path:
1. Create work item → launch office hours → finish → artifact saved
2. Launch CEO review on same work item → verify prior context injected
3. Launch breakdown → commit tasks → verify hierarchy
4. Stage detection verifies stage advances correctly through the flow
5. Session replay loads correctly in read-only mode

**Commit:**
```bash
git commit -m "test: planning pipeline UX end-to-end integration tests"
```
