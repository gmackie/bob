# E2E Tests for Agent Status Toolkit

This directory contains Playwright E2E tests for the Agent Status Toolkit UI components.

## Test Status

**Currently SKIPPED** - Tests require proper app startup.

### Prerequisites

Ensure `apps/nextjs` (Bob) is running on port 3000, NOT `apps/web`:

```bash
# From project root
cd apps/nextjs
pnpm dev
```

### Known Issues

1. **Wrong App Running** - If another Next.js app (`apps/web`) is running on port 3000, tests will fail with auth redirects to `/login`
2. **Auth Protection** - The Bob app may have auth that protects the `/test-components` route

## What Was Created

### Test Infrastructure

- `e2e/fixtures/test-setup.ts` - Extended Playwright test with custom fixtures and selectors
- `e2e/fixtures/trpc-mock.ts` - tRPC mocking utilities for deterministic tests
- `e2e/fixtures/ws-mock.ts` - WebSocket mock utilities for gateway testing
- `e2e/mock-data/workflow.ts` - Mock workflow state data
- `e2e/mock-data/sessions.ts` - Mock session data

### Test Component Page

- `src/app/(test)/test-components/page.tsx` - Standalone test page rendering components in isolation
- `src/app/(test)/layout.tsx` - Minimal layout for test routes

### Test Specs (65 test cases)

- `e2e/specs/session-header.spec.ts` - SessionHeader component tests
  - Session status badge (running, idle, stopped, error, starting)
  - Workflow status badge (started, working, awaiting_input, blocked, awaiting_review, completed)
  - Header content, PR badge, task badge

- `e2e/specs/awaiting-input-card.spec.ts` - AwaitingInputCard component tests
  - Question display
  - Option buttons
  - Custom response input
  - Time remaining countdown
  - Expired state

- `e2e/specs/resolved-input-card.spec.ts` - ResolvedInputCard component tests
  - Human resolution
  - Timeout resolution

- `e2e/specs/workflow-transitions.spec.ts` - Workflow state transition tests
  - WebSocket status updates
  - Valid state transitions
  - Combined session and workflow status

### Data-testid Attributes Added

Components in `src/app/chat/_components/` have been enhanced with data-testid attributes:

**session-header.tsx:**

- `session-header`, `session-title`
- `session-status-badge` (with `data-status`)
- `workflow-status-badge` (with `data-workflow-status`)

**awaiting-input-card.tsx:**

- `awaiting-input-card` (with `data-expired`)
- `time-remaining`, `input-question`, `input-options`
- `input-option-{idx}`, `custom-response-section`
- `custom-response-input`, `custom-response-submit`
- `default-action-info`

**ResolvedInputCard:**

- `resolved-input-card` (with `data-resolution-type`)
- `resolution-type-label`, `resolved-question`, `resolved-answer`

## Running Tests

Once auth bypass is configured:

```bash
# Run all E2E tests
pnpm -F @bob/nextjs test:e2e

# Run with UI mode
pnpm -F @bob/nextjs test:e2e:ui

# Run headed (visible browser)
pnpm -F @bob/nextjs test:e2e:headed
```

## To Enable Tests

Remove `.skip` from the test.describe calls in each spec file after implementing auth bypass.
