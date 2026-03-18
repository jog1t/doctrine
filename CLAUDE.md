# Doctrine - Claude Code Guardrails

> **IMPORTANT**: This file must be kept aligned with the actual codebase. If architecture, runtime ownership, schema, or workflow constraints change, update this file in the same pass.

## Project Overview

Doctrine is a strategy game where players write instruction systems ("doctrine") governing autonomous agents.

Current repo reality:

- single `gameWorld` actor owns the world
- client UI is React
- auto-tick is still client-driven today
- M2-style mechanics exist in code: working memory, episodic memory, doctrine versioning, tower radius sync, threats, hard death, debrief memory UI
- M2.5+ systems like spawn recovery, wave propagation, tower construction, and multiplayer are not shipped yet

For a current-state narrative, read `HANDOFF.md`.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | RivetKit actors + Hono |
| Frontend | React 19 + Vite |
| Shared types | TypeScript |
| Monorepo | pnpm workspaces (`server/`, `client/`, `shared/`) |
| Linter | oxlint |
| Formatter | oxfmt |

## Project Structure

```text
doctrine/
├── shared/src/index.ts          # Shared contract and default doctrine
├── server/src/
│   ├── actors/game-world.ts     # Main actor and world state owner
│   ├── actors/registry.ts       # RivetKit registry
│   ├── engine/agent-logic.ts    # Deterministic decision logic
│   ├── engine/map-generator.ts  # Seeded map generation
│   └── index.ts                 # Hono entrypoint using registry.handler(...)
├── client/src/
│   ├── components/              # UI components
│   ├── rivet.ts                 # createRivetKit() setup
│   └── App.tsx                  # Actor connection and local auto-tick
├── HANDOFF.md                   # Current state and known caveats
├── ARCHITECTURE.md              # Durable architecture notes
└── CLAUDE.md                    # This file
```

## Core Guardrails

### 1. All gameplay state lives on the server actor

React state may hold UI concerns like loading state, form dirtiness, local expansion state, and error banners.

Do not move gameplay simulation or authoritative world state into React.

### 2. Types are the contract

Update `shared/src/index.ts` before changing server or client behavior.

If a field is not in the shared types, treat it as non-existent from a feature-contract perspective.

### 3. Agent logic stays deterministic

`executeAgent(...)` and adjacent engine logic should remain deterministic and side-effect free.

No `Math.random()` in engine decisions.

### 4. Decision and mutation remain separate

Preserve the two-phase pattern:

- decision phase returns actions
- mutation phase applies actions to state

Do not collapse those phases casually; replay/debugging depends on the separation.

### 5. Doctrine is versioned on every deploy

Never reset doctrine version to 0 or treat doctrine as mutable in place. Deploying means creating a new version.

Agents carry `deployedDoctrineVersion`, and stale-version behavior is intentional.

### 6. Map generation remains seeded

Same seed should produce the same map.

Do not introduce unseeded randomness into map generation or simulation logic.

### 7. Use events for state push to clients

Use actor broadcasts and client event listeners for state updates.

Do not add polling loops to keep the UI in sync.

### 8. Single actor remains the default

Do not split gameplay into multiple actors without a concrete milestone need and an explicit architectural reason.

The codebase is not ready for speculative actor decomposition.

## Runtime Reality To Respect

These are true today, even if they are not the ideal long-term architecture:

- auto-tick is still driven by a client `setInterval`
- server-side tick-control actions exist but are not wired into the UI
- doctrine validation is light at deploy time and relies heavily on normalization
- the client only receives `previousDoctrine`, not full `doctrineHistory`
- threats can damage agents, but threat neutralization is not fully implemented

Do not write docs or code as if those problems are already solved.

## RivetKit / Transport Patterns

```ts
// Server entry
const app = new Hono();
app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

// React client
const { useActor } = createRivetKit();
const world = useActor({ name: "gameWorld", key: ["default"] });

// Events
world.useEvent("gameInitialized", callback);
world.useEvent("tickCompleted", callback);
world.useEvent("doctrineDeployed", callback);
```

Notes:

- Do not reintroduce `registry.serve()` examples into docs unless the server actually uses that pattern again.
- `createRivetKit<typeof registry>` is not currently used because of cross-package type-branding issues; match the live client setup unless that issue is explicitly solved.

## TypeScript / Monorepo Rules

- `@doctrine/shared` is the shared contract package
- use pnpm workspaces, not npm workspaces
- avoid changing tsconfig structure casually; cross-workspace typing is already sensitive
- if you change tsconfig conventions, update this file and explain why

## Package Management

- Use `pnpm`
- Root scripts include:
  - `pnpm dev`
  - `pnpm dev:server`
  - `pnpm dev:client`
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm format`

## Milestone Guidance

Do not assume the old M1-only docs are accurate. Use this mental model instead:

- `Shipped in code`: M1 core loop plus parts of M2
- `High-priority next work`: M2.5a recovery/spawn systems and infrastructure cleanup
- `Not shipped yet`: M2.5b+, M3+, multiplayer, LLM layers

If you need milestone truth, cross-check `HANDOFF.md` and the code.

## What Not To Do

- do not add `Math.random()` to engine logic
- do not move authoritative world state into React
- do not add speculative schema fields without updating `shared/src/index.ts`
- do not assume server-side ticking is already active
- do not claim multiplayer behavior that the current actor/runtime does not implement
- do not implement LLM reasoning paths before a concrete milestone requires it
- do not skip doc updates when runtime patterns change

## Git

- do not add `Co-Authored-By: Claude` lines to commits
- keep unrelated user changes intact
