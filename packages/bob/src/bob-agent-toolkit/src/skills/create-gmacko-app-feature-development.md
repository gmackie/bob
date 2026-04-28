---
name: create-gmacko-app-feature-development
description: Use when implementing a feature in a create-gmacko-app repo and you need to know where code belongs across apps/nextjs, packages/ui, packages/api, packages/db, local helpers, and shared packages - keeps feature work uniform, package-scoped, and ready to promote into shared layers when reuse appears
---

# Create Gmacko App Feature Development

## Overview

Treat create-gmacko-app repos as standardized systems, not custom monorepos.

The main rule is simple: place code in the narrowest correct layer first, then promote it only when reuse is real.

## When to Use

- Building a new feature in a repo generated from `create-gmacko-app`
- Deciding whether code belongs in `apps/nextjs` or a shared package
- Splitting one request across UI, API, DB, helper, and integration changes
- Cleaning up a feature so the same pattern is repeated consistently in every generated repo

Do not use this for backend-only repos or when the create-gmacko-app structure is absent.

## Quick Reference

| Need | Primary location |
| --- | --- |
| Route segments, page composition, app-specific providers, app-only hooks | `apps/nextjs` |
| Reusable components, tokens, and shared stories | `packages/ui` |
| Server routers, procedures, business logic, and server-side helpers | `packages/api` |
| Schema, migrations, seed data, and DB-level helpers | `packages/db` |
| Web end-to-end coverage and browser flow specs | `apps/nextjs` with Playwright and `/browse` |
| Mobile end-to-end coverage for Expo flows | `apps/expo/.maestro` |
| Product and implementation artifacts | `docs/ai` |
| Claude workflow conventions | `.claude/skills` |

## Placement Rules

1. Start at the user-facing surface, then trace inward.
2. Keep app wiring in `apps/nextjs`.
3. Put reusable UI in `packages/ui`.
4. Put backend behavior in `packages/api`.
5. Put schema and persistence concerns in `packages/db`.
6. Keep helpers close to the layer they serve until reuse is proven.
7. Promote code into a package only when at least two consumers or a stable platform concern justify it.

## Layer Decisions

### `apps/nextjs`

Use for:
- routes
- page composition
- layout wiring
- app-specific forms
- feature-specific hooks tied to one screen or flow
- provider assembly

Do not put shared primitives here just because the feature started in the web app.

### `packages/ui`

Use for:
- shared components
- component variants
- design primitives
- story files
- reusable client-side view helpers that only support shared UI

If the component can appear in more than one screen or flow, default toward `packages/ui`.

### `packages/api`

Use for:
- routers
- server actions and procedures
- domain services
- validation that belongs to backend behavior
- integration orchestration that is not persistence-only

Keep UI formatting and page concerns out of this layer.

### `packages/db`

Use for:
- schema
- migrations
- seeds
- query helpers
- persistence-specific transforms

Do not put request orchestration or route concerns here.

## Helper Rules

- If a helper is only used by one page or route, keep it in that feature folder.
- If a helper is reused by multiple files in one layer, move it to a layer-local helper module in that same package.
- If a helper crosses app boundaries and supports a stable shared concern, promote it into the appropriate shared package.
- Avoid creating a generic `utils` bucket before the helper has a clear home.

## Standard Feature Flow

1. Confirm intent in `docs/ai/INITIAL_PROPOSAL.md` or the current implementation plan.
2. Split the request by layer before writing code.
3. Land shared UI in `packages/ui` first when the feature needs reusable components.
4. Wire the feature into `apps/nextjs`.
5. Add backend and DB changes only in the layers that own them.
6. Update stories for shared UI.
7. Verify the web flow with Playwright and browser QA via `gstack /browse` when the feature touches the React surface.
8. Verify mobile impact with Maestro in `apps/expo/.maestro` when the feature affects Expo flows.
9. Verify the final flow end to end.

## Validation Stack

### Playwright

Use Playwright for deterministic web flows in `apps/nextjs`.

- Keep new end-to-end coverage close to the flow it validates.
- Prefer flow-oriented specs over broad regression buckets.
- Run the project scripts for the web app instead of inventing one-off commands.

### gstack `/browse`

Use `gstack /browse` for browser QA and visual verification before and after implementation.

- Use it to confirm Storybook states, route-level behavior, and integration handoffs in the real browser.
- Prefer `/browse` over ad hoc browser tooling when the repo already ships gstack guidance.
- Treat `/browse` as the fast inspection loop and Playwright as the repeatable regression layer.

### Maestro

Use Maestro for Expo mobile end-to-end coverage from `apps/expo/.maestro`.

- Add or update flows when the feature changes mobile onboarding, forms, navigation, or deep-link behavior.
- Keep mobile assertions focused on user-visible outcomes.
- Use recording or studio modes when mapping a new device flow, then keep the checked-in flow concise.

## Common Mistakes

- Building a reusable component directly in `apps/nextjs`
- Moving helpers to a shared package before reuse exists
- Mixing route wiring, business logic, and schema changes into one unstructured file
- Creating generic `helpers` or `utils` modules with no layer ownership
- Forgetting to update Storybook when shared UI changes
- Shipping a React feature without deciding whether it needs Playwright coverage, `/browse` validation, or Maestro coverage

## Rationalization Table

| Excuse | Reality |
| --- | --- |
| "It is faster to keep everything in apps/nextjs" | That makes every generated repo diverge and hides reuse opportunities. |
| "I might reuse this later so I should make a package now" | Premature extraction creates unstable shared APIs. Reuse has to be real. |
| "This helper is generic so it belongs in utils" | Generic location names hide ownership. Put helpers in the layer that uses them. |
| "The API change is small so I can keep it near the page" | Behavior still belongs to `packages/api`, even when the first consumer is one page. |
| "I will add stories after the feature works" | Shared UI without stories becomes inconsistent across repos. |
| "Manual browser clicking is enough for this flow" | `gstack /browse` is for inspection, but durable React flow coverage belongs in Playwright and Maestro where applicable. |

## Red Flags

- New reusable component under `apps/nextjs`
- New catch-all `utils.ts` with mixed concerns
- Shared helper created without a second consumer
- API logic living in page files
- DB transforms living in router files
- React flow changed with no matching browser or mobile validation plan

If any of these appear, stop and remap the feature by layer.

## Example

For a new billing settings feature:

- Put the billing page route, form wiring, and app-specific hooks in `apps/nextjs`
- Put reusable status cards and billing form fields in `packages/ui`
- Put billing update procedures and provider orchestration in `packages/api`
- Put billing tables, schema changes, and persistence helpers in `packages/db`
- Keep feature-only helpers in the billing feature folder until reuse appears
