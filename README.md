# Doctrine

Doctrine is a strategy game prototype where players write instruction systems ("doctrine") that govern autonomous agents.

The codebase is currently beyond the original M1 prototype docs: it includes working memory, episodic memory, doctrine versioning, tower-based doctrine sync, roaming threats, hard death, and debrief/memory UI. It is still a single-actor, single-player prototype and does not yet have server-authoritative ticking, spawn recovery, wave propagation, or multiplayer.

## Tech Stack

- Backend: RivetKit actors + Hono
- Frontend: React 19 + Vite
- Shared contract: TypeScript workspace package (`@doctrine/shared`)
- Monorepo: pnpm workspaces (`server`, `client`, `shared`)
- Lint/format: oxlint + oxfmt

## Current State

- Runtime model: one `gameWorld` actor owns all world state
- Tick model: manual ticks and client-driven auto-tick from the React app
- Shipped mechanics:
  - working memory (Tier 1)
  - episodic memory (Tier 2)
  - per-agent doctrine versioning
  - tower radius doctrine synchronization
  - scout intel / known resource sharing
  - threats, damage, and hard death
  - map/debrief UI for stale doctrine and agent memory
- Not shipped yet:
  - server-driven tick scheduling
  - replacement spawning after agent death
  - wave propagation for doctrine updates
  - tower construction/capture/destruction
  - shared-vs-perceived map split
  - deception systems
  - multiplayer campaign flow

## Project Structure

```text
doctrine/
	client/      # React app (Vite, port 5173)
	server/      # RivetKit/Hono server (port 6420)
	shared/      # Shared types used by both client and server
	HANDOFF.md   # Current-state engineering handoff
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
- `client/src/App.tsx` still drives auto-tick locally; server-side scheduling is planned but not wired yet.

For current implementation details, see `HANDOFF.md`.

For guardrails and architectural direction, see `CLAUDE.md` and `ARCHITECTURE.md`.
