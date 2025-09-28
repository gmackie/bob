# Repository Guidelines

## Project Structure & Module Organization
- backend: Express + WebSocket API in `backend/src` (TypeScript). DB at `backend/bob.db`; migrations in `backend/src/database/migrations`.
- frontend: React + Vite UI in `frontend/src` (TypeScript). Components in `frontend/src/components`.
- electron: App shell (`electron/main.js`, assets in `electron/assets`).
- scripts and docs: Helpers in `scripts/`, screenshots in `docs/screenshots/`.

## Build, Test, and Development Commands
- Install: `npm run install:dependencies` — installs root, backend, and frontend packages.
- Dev (web): `npm run dev` — runs backend on `:43829` and frontend on `:47285`.
- Dev (app): `npm run dev:app` — runs backend, frontend, then launches Electron.
- Build: `npm run build` — builds frontend and backend; `npm run build:app` packages via electron-builder.
- Database: `npm run migrate:status|up|down` — run migrations (delegates to backend CLI).
- Start (prod API): `npm run start` — serves built backend; in prod, it also serves `frontend/dist`.

## Coding Style & Naming Conventions
- Language: TypeScript across backend/frontend; Node/Electron in ESM.
- Indentation: 2 spaces; quotes: single; end statements with semicolons.
- Naming: React components and files PascalCase (e.g., `RepositoryPanel.tsx`); backend modules lowercase (e.g., `routes/repositories.ts`).
- Formatting/Lint: No enforced linters; match existing style and keep imports ordered logically.

## Testing Guidelines
- No formal unit test suite yet. Validate changes by:
  - Running `npm run dev:app` and exercising key flows.
  - Checking API health at `GET http://localhost:43829/api/health`.
- For complex logic, include small targeted tests or add coverage notes in the PR.

## Commit & Pull Request Guidelines
- Commits: Imperative, concise, present tense (e.g., "Fix data refresh handling"). Group related changes.
- PRs: Include description, rationale, and scope (backend/frontend/electron). Attach screenshots for UI changes (`docs/screenshots/` helpful). Link issues when applicable.
- Keep diffs focused; include migration steps if DB schema changes.

## Security & Configuration Tips
- Do not commit secrets or tokens. Avoid checking in local `backend/bob.db` changes; prefer migrations.
- Native module `node-pty` may need `npm run rebuild:native` (or `:mac` on macOS) after Node/Electron upgrades.
