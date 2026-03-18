# TODOS

## UI/UX

**Priority:** P1
- [ ] Planning hub redesign — replace /planning with projects grid, remove Chat from sidebar, scope chat to tasks
  - Tasks #22-25 are ready to execute
  - See brainstorming notes in this conversation for navigation flow decisions

**Priority:** P2
- [ ] Full diff rendering in PR detail page — needs a diff parser library (e.g., diff2html)
- [ ] Mobile-responsive workspace layout — 3-panel doesn't collapse on small screens
- [ ] PR line-level comment threads — currently only review-level comments supported

## Infrastructure

**Priority:** P2
- [ ] Playwright-based browser capture — /api/capture has placeholder SVG for browser targets, needs real Playwright integration
- [ ] Real-time capture streaming — auto-capture polls at intervals, WebSocket streaming would be smoother
- [ ] JJ split/rebase operations — only new/squash/describe implemented in jj-client.ts

## Testing

**Priority:** P2
- [ ] Component tests for new UI (PR list, file tree, capture panel, revision graph, requirements checklist)
- [ ] E2E tests for critical flows (create task → agent runs → PR → merge)

## Completed

- [x] Router/API tests for requirement, featureBranch, upload, capture — **Completed:** v0.0.4 (2026-03-17)
- [x] Error boundaries around major feature sections — **Completed:** v0.0.4 (2026-03-17)
- [x] Auth checks on /api/upload and /api/capture routes — **Completed:** v0.0.4 (2026-03-17)
- [x] Database indexes on new table FK columns — **Completed:** v0.0.4 (2026-03-17)
