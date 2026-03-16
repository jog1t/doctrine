# Doctrine — Claude Code Guardrails

> **IMPORTANT**: This file MUST be updated whenever architectural decisions change, new patterns are introduced, or guardrails are modified. It is the authoritative reference for AI-assisted development on this project.

## Project Overview

Doctrine is a multiplayer strategy game where players write instruction systems ("doctrine") governing autonomous AI agents. Currently at **Milestone 1**: single-player core loop prototype.

## Tech Stack

| Layer        | Technology                                        |
| ------------ | ------------------------------------------------- |
| Backend      | RivetKit actors (rivetkit@^2.1.6)                 |
| Frontend     | React 19 + Vite                                   |
| Shared types | TypeScript                                        |
| Monorepo     | pnpm workspaces (`server/`, `client/`, `shared/`) |
| Linter       | oxlint (oxc.rs)                                   |
| Formatter    | oxfmt (oxc.rs)                                    |

## Project Structure

```
doctrine/
├── shared/src/index.ts        # All shared types — source of truth for schema
├── server/src/
│   ├── actors/game-world.ts   # Main RivetKit actor — owns all game state
│   ├── actors/registry.ts     # Actor registry
│   ├── engine/agent-logic.ts  # Pure agent decision functions
│   ├── engine/map-generator.ts # Seeded map generation
│   └── index.ts               # Server entry (registry.serve())
├── client/src/
│   ├── components/            # React components
│   ├── rivet.ts               # createRivetKit<typeof registry> setup
│   └── App.tsx                # Main app — connects to gameWorld actor
├── CLAUDE.md                  # This file — update always
└── ARCHITECTURE.md            # Architecture decisions and reasoning
```

## Core Guardrails

### 1. All game state lives in actors

Client-side state is UI-only (loading flags, form dirty state, local selection). No game logic or game state on the client.

### 2. Types are the contract

**Always update `shared/src/index.ts` first** before changing server or client behavior. The shared types are the single source of truth for the server/client contract.

### 3. Agent logic is pure

`executeAgent(agent, doctrine, map, tick): AgentAction` — no side effects, no randomness, no I/O. This enables deterministic replay (planned for M8).

### 4. Actions are applied separately

Two-phase: decision phase (`executeAgent`) then mutation phase (`applyAction`). Keep these separate.

### 5. Doctrine is versioned

Every `deployDoctrine()` call increments the doctrine version. Agents carry their deploy version for Fog of Self (M6). Never reset version to 0 on deploy.

### 6. Map generation is seeded

`generateMap(seed)` with mulberry32 PRNG. Same seed = same map, always. Never use `Math.random()` in map or agent logic.

### 7. Events, not polling

Use RivetKit `c.broadcast()` on the server and `world.useEvent()` on the client for all state updates. Never poll actor state from client timers (except the intentional auto-tick `executeTick()` call).

### 8. Single actor for now

`gameWorld` actor holds all state for M1. Future splits are planned (per-agent actors in M2, map chunk actors in M3, matchmaking in M9) — do not add actor splits until those milestones.

## RivetKit Patterns

```typescript
// Actor definition
export const gameWorld = actor({ state: {...}, actions: {...} });

// Registry
export const registry = setup({ use: { gameWorld } });

// Server entry
registry.serve();

// React client
const { useActor } = createRivetKit<typeof registry>({ endpoint: "..." });
const world = useActor({ name: "gameWorld", key: ["default"] });

// Events
c.broadcast("eventName", data);          // server side
world.useEvent("eventName", callback);   // client side
```

## TypeScript / Monorepo Rules

- `@doctrine/shared` path alias resolves to `../shared/src/index.ts` in both tsconfig and vite config
- Do NOT use TypeScript project references (`composite: true`) — use `paths` + `include` array instead
- Do NOT add `declaration`/`declarationMap` to `tsconfig.base.json` — causes "cannot be named" errors
- Do NOT add `rootDir` to `server/tsconfig.json` — shared files live outside `server/src`
- `noEmit: true` in all tsconfig files — compilation is handled by Vite/tsx, not tsc

## Package Management

- Use **pnpm** (not npm). Workspace config is in `pnpm-workspace.yaml`.
- `pnpm install` at root installs all workspaces
- Scripts: `pnpm dev`, `pnpm dev:server`, `pnpm dev:client`, `pnpm typecheck`, `pnpm lint`, `pnpm format`

## Linting / Formatting

- **oxlint** for linting: `pnpm lint` runs `oxlint .`
- **oxfmt** for formatting: `pnpm format` runs `oxfmt .`
- Both from [oxc.rs](https://oxc.rs) — fast Rust-based tools, no Prettier/ESLint

## Milestone Roadmap (Do Not Skip Ahead)

| Milestone | Description                                                 |
| --------- | ----------------------------------------------------------- |
| M1 (done) | Single-player core loop — RivetKit actors + React UI        |
| M2        | Agent memory tiers (per-agent state, working memory)        |
| M3        | Shared map / PvP foundation                                 |
| M4–M8     | Elaboration (fog of war, doctrine versioning, replay, etc.) |
| M9        | Full multiplayer with matchmaking actor                     |

## Git

- Do **not** add `Co-Authored-By: Claude` lines to commits — use the repo's configured git identity only

## What NOT to Do

- Do not add `Math.random()` to engine code
- Do not put game state in React `useState`
- Do not add actor-to-actor communication before M2
- Do not implement LLM/AI calls — agents are rule-based through M4 at minimum
- Do not add authentication — out of scope for prototype milestones
- Do not skip `shared/` type updates when changing the data model
