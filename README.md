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

## Contributing

Bob Builder is not ready for a broad open-source launch yet, but small,
well-scoped contributions are welcome as the ForgeGraph reliability surface
settles. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for the current
license direction, contributor workflow, response expectations, RFC process,
and community channel policy.

Good starter tasks are labeled `good first issue` when they are low-risk,
reproducible from a clean checkout, and include clear acceptance criteria.
Please open a GitHub issue before starting larger work so maintainers can keep
prototype priorities explicit.

## Product Model

- `workspaces` and `projects` provide Bob's execution and planning context
- canonical `work_items` live in ForgeGraph and are consumed by Bob for planning and execution
- `tasks` are the executable work items Bob works on
- Bob sessions, task runs, worktrees, transcripts, and artifacts power planning and execution
- web and mobile both use the same product-facing tRPC router
