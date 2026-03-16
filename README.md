# Doctrine

Doctrine is a multiplayer strategy game prototype where players write instruction systems ("doctrine") that control autonomous agents.

The current implementation is Milestone 1: a single-player core loop built with RivetKit actors (server) and React (client).

## Tech Stack

- Backend: RivetKit actors + Hono
- Frontend: React 19 + Vite
- Shared contract: TypeScript workspace package (`@doctrine/shared`)
- Monorepo: pnpm workspaces (`server`, `client`, `shared`)
- Lint/format: oxlint + oxfmt

## Project Structure

```text
doctrine/
	client/      # React app (Vite, port 5173)
	server/      # RivetKit/Hono server (port 6420)
	shared/      # Shared types used by both client and server
```

## Prerequisites

- Node.js 20+ recommended
- pnpm installed globally

Install pnpm if needed:

```bash
npm i -g pnpm
```

## Getting Started

1. Install dependencies from the repository root:

```bash
pnpm install
```

2. Start both server and client in dev mode:

```bash
pnpm dev
```

3. Open the app:

- Client UI: http://localhost:5173
- Server: http://localhost:6420

Vite proxies `/api/rivet` to the server, so the client can talk to RivetKit through one local origin while developing.

## Available Commands

Run from repository root:

- `pnpm dev` - start client and server together
- `pnpm dev:server` - start only server
- `pnpm dev:client` - start only client
- `pnpm build` - build all workspace packages
- `pnpm typecheck` - run TypeScript type checks for server and client
- `pnpm lint` - run oxlint
- `pnpm format` - run oxfmt

## Architecture Notes

- All game state lives in the server actor (`gameWorld`).
- Client state is UI-only.
- Shared types in `shared/src/index.ts` are the source of truth for server-client contracts.
- Map generation and agent decisions are deterministic (no runtime randomness in engine logic).

For deeper architectural guardrails and milestone constraints, see `CLAUDE.md` and `ARCHITECTURE.md`.
