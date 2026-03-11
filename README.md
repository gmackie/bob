# Bob Builder

Bob Builder is the merged monorepo for:

- `apps/web`: the primary Next.js product shell
- `apps/mobile`: the mobile app for planning and task execution
- `apps/execution`: the long-running execution service
- `apps/gateway`: the PTY/session gateway used by execution flows
- `packages/*`: shared API, DB, auth, realtime, work-item, and agent libraries

## Development

```bash
pnpm install
pnpm db:push
pnpm dev
```

Useful targets:

```bash
pnpm dev:web
pnpm dev:mobile
pnpm dev:execution
pnpm dev:web:gateway
pnpm typecheck
pnpm lint
pnpm build
```

## Product Model

- `workspaces`, `projects`, and typed `work_items` drive planning
- `tasks` are the executable work items
- Bob sessions, task runs, worktrees, and artifacts power execution
- web and mobile both use the same product-facing tRPC router
