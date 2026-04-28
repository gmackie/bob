---
name: work-item-shaping
description: Use when a user is past a rough idea and needs to shape it into a Bob epic or issue with clearer scope, a business requirements document, or structured requirements - guides question-driven brainstorming, choosing the right work item kind, and capturing the parent work item cleanly before execution starts
---

# Work Item Shaping

## Overview

Treat shaping as a conversation that turns ambiguity into a parent Bob work item.

The goal is not to jump straight to implementation. The goal is to produce an epic or issue with enough clarity that requirements and tasks can be derived cleanly.

## When to Use

- A user has a feature idea but the scope is still fuzzy
- A user has a broad initiative that may need an epic and a BRD
- A bug or operational problem needs to be defined as an issue before execution
- A planning session needs to decide whether the result should be an issue, epic, or immediately executable task

Do not use this when the work is already a small, directly executable task.

## Quick Reference

| Situation | Output |
| --- | --- |
| Multi-step feature or initiative | Parent `epic` plus BRD or structured requirements |
| Bug, incident, or narrow problem that still needs scoping | Parent `issue` plus requirements |
| Already concrete and one-session sized | Skip shaping and create a `task` |

## Conversation Pattern

1. Start from the outcome the user wants.
2. Ask one question at a time.
3. Clarify users, problem, boundaries, constraints, and success signals.
4. Decide whether the parent should be an `epic` or `issue`.
5. Capture a concise parent description.
6. Produce a BRD when the work is large enough to need a longer artifact.
7. Extract initial requirement categories onto the parent work item.

## Bob Storage Rules

- The parent work item is the source of truth for the initiative or problem.
- Use an `epic` for grouped feature work and an `issue` for shaped bugs or problems.
- Put the concise summary in the parent work item description.
- If the BRD is longer, attach it as a current artifact with role `documentation`.
- Keep requirements on the parent epic or issue using Bob's requirement categories:
  - `data`
  - `api`
  - `ui`
  - `infra`
  - `test`
  - `other`
- Do not create child tasks until the parent scope is stable enough to plan.

## Minimum Shaping Output

- Work item kind: `epic` or `issue`
- Clear title
- Problem or opportunity statement
- In-scope outcomes
- Out-of-scope boundaries
- Constraints or risks
- Success signals
- BRD or business requirements document when needed
- Initial requirements grouped by category

## Example

For "we should improve onboarding for new team admins":

- Create an `epic`
- Write a parent description that explains the admin problem, target persona, main success metric, constraints, and non-goals
- If the scope is broad, attach a BRD as `documentation`
- Add initial requirements such as:
  - `ui`: first-run guidance and empty-state messaging
  - `api`: org setup status endpoint
  - `data`: onboarding completion state
  - `test`: coverage for first-run and returning-admin paths

## Common Mistakes

- Turning fuzzy work directly into tasks
- Asking a long interview instead of one question at a time
- Mixing requirements with implementation details too early
- Creating a BRD without converting it into Bob requirements
- Treating child tasks as the primary place to store scope

## Red Flags

- The user is still answering basic scope questions, but tasks are already being drafted
- The parent work item has no clear success signal
- Requirements are scattered across comments instead of living on the parent item
- The BRD exists, but no structured requirements were added to Bob
