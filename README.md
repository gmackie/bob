# Bob Builder

Bob Builder is the merged monorepo for:

- `apps/web`: the primary Next.js product shell
- `apps/mobile`: the mobile app for planning and task execution
- `apps/ws-gateway`: slim WebSocket relay between clients and the Go daemon
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
pnpm typecheck
pnpm lint
pnpm build
```

## Product Model

- `workspaces` and `projects` provide Bob's execution and planning context
- canonical `work_items` live in ForgeGraph and are consumed by Bob for planning and execution
- `tasks` are the executable work items Bob works on
- Bob sessions, task runs, worktrees, transcripts, and artifacts power planning and execution
- web and mobile both use the same product-facing tRPC router
