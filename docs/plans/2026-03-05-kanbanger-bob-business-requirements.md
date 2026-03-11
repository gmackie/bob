# Kanbanger + Bob Integration Business Requirements

Date: 2026-03-05
Status: Draft v1 baseline
Related docs:
- `docs/plans/2026-03-05-kanbanger-bob-v1-feature-list-and-gameplan.md`
- `docs/plans/2026-03-05-kanbanger-bob-high-level-technical-design.md`
- `docs/plans/2026-03-05-bob-integration-low-level-design.md`
- `../linear-clone/docs/plans/2026-03-05-kanbanger-integration-low-level-design.md`

## Summary

Kanbanger is the primary product surface and system of record for issue ownership, workflow status, and human coordination. Bob is the execution console for agent work. Users should be able to assign an issue to Bob from Kanbanger, monitor progress without leaving Kanbanger, respond to agent questions from Kanbanger comments or Bob chat, and rely on merged PR state from Kanbanger/ForgeGraph as the canonical completion signal.

## Product goals

1. Make Kanbanger the default place where humans manage agent-run work.
2. Make Bob the best place to inspect and interact with the live agent session.
3. Keep issue status, milestone updates, blocking questions, PR links, and verification results synchronized without requiring manual copy/paste.
4. Preserve a clean audit trail showing what the agent did, what humans approved, and why an issue moved through review or completion states.
5. Support one workspace and one Bob deployment in v1 without painting the system into a corner for future multi-workspace or multi-agent expansion.

## Operating model

1. A Kanbanger issue can have at most one active Bob session at a time.
2. A Kanbanger project owns the default repository context for Bob session launches.
3. Workspace policy can support both auto-start and manual `Start with Bob`.
4. Bob may update Kanbanger to `in_progress`, `blocked`, and `in_review` automatically.
5. Bob may attach PR, build, test, and verification artifacts automatically.
6. An issue moves to `done` only from the canonical merged PR signal produced by Kanbanger/ForgeGraph.
7. Human responses can arrive from either Kanbanger comments or Bob chat.
8. Kanbanger comments become agent input only when an issue has an active Bob session and the comment is either on the latest Bob prompt thread or explicitly directed at Bob.

## Core user experience

### 1. Assign and start

1. A human assigns an issue to the Bob agent identity in Kanbanger.
2. Kanbanger shows a lightweight Bob panel on the issue.
3. Depending on workspace policy, Bob either starts automatically or waits for a human to click `Start`.
4. The panel shows current session state, latest summary, repository/worktree context, and an `Open Bob` link.

### 2. Active execution

1. Kanbanger stays readable and concise.
2. Bob posts milestone updates as structured comments and timeline/activity entries, not a full transcript.
3. The issue panel shows the latest agent state, artifacts, and last update time.
4. Opening Bob drops the user into the live session for deeper inspection.
5. Artifact links are canonical issue data in Kanbanger, with parent issues showing aggregated child artifacts grouped by child issue.

### 3. Blocked or awaiting input

1. Bob posts a structured Kanbanger comment containing:
   - the question
   - selectable options
   - the default action
   - the timeout
   - a deep link back to Bob
2. The Kanbanger panel also shows a visible `needs input` or `blocked` state.
3. A human can answer from Kanbanger comments or Bob chat.
4. Bob consumes the answer, resolves the prompt, returns to `working`, and posts a concise resolution update.
5. Workspace defaults for prompt timeout live in Kanbanger, with optional project overrides and per-prompt override from Bob.

### 4. Review and completion

1. Bob moves the issue to `in_review` when work is ready.
2. Bob attaches PR and verification artifacts.
3. Kanbanger/ForgeGraph remains the source of truth for merge state.
4. When the PR merges, Kanbanger moves the issue to `done` and Bob marks the session complete.

### 5. Re-runs and scope changes

1. Restarting Bob work on an issue creates a fresh Bob run/session rather than reusing the old one.
2. The new run inherits a structured handoff context assembled from the issue, prior Bob summaries, artifact state, and latest review/merge status.
3. Ordinary scope edits continue the active run.
4. Repository or project context changes supersede the current run and start a fresh run without resetting issue status.

## Business requirements

### Required in v1

1. Web issue page integration in Kanbanger.
2. Bob panel with start, resume, stop, and open actions.
3. Structured milestone comments from Bob.
4. Structured blocking comments with reply ingestion.
5. One active Bob session per issue.
6. Project default repository mapping.
7. Workspace-trusted integration with Bob maintaining its own login separately.
8. Read-only mobile visibility for Bob status, comments, and links.
9. Compact run history on the issue with links back to prior Bob sessions.
10. Normalized artifact storage and parent issue artifact roll-up.
11. Lightweight Bob/artifact indicators in list and board views.
12. Canonical `blocked` issue status used by Bob-driven workflows.

### Explicitly out of scope for v1

1. Full transcript mirroring into Kanbanger.
2. Per-user SSO/shared identity between Kanbanger and Bob.
3. Fine-grained permissions beyond existing workspace trust.
4. Multiple public Bob assignee personas on issues.
5. Mobile parity for session control.
6. Automatic issue completion from anything other than the canonical merged PR signal.
7. Inline choice buttons for Bob prompts in Kanbanger comments or sidebar.

## Success criteria

1. A user can manage Bob-driven work from Kanbanger without needing Bob open most of the time.
2. Every Bob-managed issue clearly shows whether the agent is working, blocked, awaiting review, or complete.
3. The agent can ask for input and get an actionable response through Kanbanger comments without human confusion.
4. There is no duplicate active Bob session for the same issue.
5. Kanbanger issue status always matches the canonical review and merge lifecycle.
6. Bob remains the richer execution view for logs, transcript, tool usage, and live intervention.
7. Artifact provenance is always clear: direct parent artifacts remain separate from aggregated child artifacts.

## Future-facing constraints

1. Kanbanger should expose one public Bob assignee identity in v1, while Bob remains free to route work internally to different agent personas.
2. The design should allow future specialized internal agents such as code-review, documentation, or verification agents without forcing a Kanbanger assignee model rewrite.
3. The integration layer should be reusable for future direct review automation or auto-approval flows, while still keeping merged PR state as the final completion trigger.
4. Kanbanger should adopt a generic `execution_backend` model now, even though only `bob` is implemented in v1.
