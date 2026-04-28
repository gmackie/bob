---
name: storybook-development
description: Use when building or iterating on React UI in Bob with Storybook and you need exhaustive state coverage, edge-case fixtures, adversarial data, and prompt-driven review loops - turns natural language product intent into structured tasks, stories, mock data, and repeatable UX critique
---

# Storybook Development

## Overview

Treat UI code as disposable and UI state coverage as the durable asset.

Use Storybook as the primary development surface for generated UI. Prompts are specifications, stories are the acceptance surface, and fixtures are how the UI proves it can survive real data.

## When to Use

- Building a new component, screen, or workflow view in React
- Generating or reviewing Storybook stories for Bob-managed UI work
- Turning natural-language product intent into component files, stories, and fixtures
- Expanding edge cases beyond a default/happy-path-only story set
- Running UX review passes against AI-generated UI before wiring live data

Do not use this for backend-only work or when Storybook is irrelevant to the change.

## Core Pattern

1. Start with a structured Bob task, not an open-ended prompt.
2. Expand the state space before generating UI code.
3. Generate component, stories, and fixtures together.
4. Review visually in Storybook before preferring code edits.
5. Iterate by changing the prompt first, then the code only when needed.

## Quick Reference

| Need | Prompt shape |
| --- | --- |
| New component | "Build a [component] for [context]. Generate component, stories, and realistic fixtures." |
| State coverage | "List all states including happy path, loading, error variants, empty, partial data, slow network, invalid input, and edge UX cases. Generate stories for all of them." |
| UX exploration | "Generate 3-5 UX variants with clear differences in density, tone, and hierarchy. Keep Storybook coverage for each." |
| Breakage testing | "Generate adversarial data: long text, null fields, malformed values, multilingual strings, emojis, and overflow cases." |
| Review pass | "Critique the stories for clarity, accessibility, feedback loops, and missing states. Update stories accordingly." |

## Bob Task Template

Use `prompts/storybook-task-template.md` as the starting work item structure.

Required sections:

- `Intent`
- `Context`
- `Required States`
- `Edge Cases`
- `UX Goals`
- `Deliverables`
- `Prompt Payload`

## Required Story Categories

Every generated component should ship with stories for:

- Happy path
- Loading
- Error variants
- Empty
- Edge cases
- Responsive variants
- Accessibility variants

Prefer descriptive names such as `Error_InvalidEmail_Retryable` and `Empty_NoResults_FirstTimeUser`. Avoid generic names such as `Default`, `Primary`, or `Variant1`.

## Prompt Library

Use `prompts/storybook-prompt-library.md` for reusable prompts covering:

- Component generation
- State expansion
- UX improvement
- Variant exploration
- Adversarial testing

## Story Template

Use `templates/component.stories.tsx.template` when you need a starting scaffold for state-first stories.

## Common Mistakes

- Generating the component before enumerating the state space
- Shipping only happy-path stories
- Using unrealistic fixture data that never stresses layout or copy
- Editing generated code manually when the prompt is the real spec that needs correction
- Naming stories by implementation variant instead of user-visible state

## Rationalization Table

| Excuse | Reality |
| --- | --- |
| "The default state is enough for now" | Missing states become bugs later. Story coverage is the work. |
| "I can add error stories later" | Later rarely happens. Enumerate the full state space first. |
| "This component is too simple for Storybook" | Simple components still fail on data shape, copy length, and responsive layout. |
| "I already know the UX" | Storybook exists to validate assumptions visually, not trust them silently. |
| "Manual edits are faster than re-prompting" | If the prompt is wrong, the next regeneration will repeat the defect. Fix the spec. |

## Red Flags

- Story names like `Default`, `Primary`, or `Variant1`
- No loading or error states
- No adversarial fixture set
- No responsive or accessibility coverage
- Prompt describes visual style but not state behavior
- Review talks about code structure before visual clarity

If any of these appear, stop and expand the stories before continuing.

## Example

```md
Build a challenge completion panel for Bob's learning flow.

Requirements:
- Must support: locked, available, in-progress, failed, retryable, completed, and reward-claimed states
- Must handle edge cases: very long challenge titles, partial reward payloads, slow network, and no next challenge
- Must be accessible: keyboard reachable actions, visible focus states, descriptive labels
- Must be responsive: mobile card, tablet split, desktop compact sidebar

Generate:
1. React + TypeScript component
2. Storybook stories for every meaningful state
3. Realistic and adversarial mock data
```
