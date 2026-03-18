# Doctrine - Architecture

## Overview

Doctrine is a strategy game where players write instruction systems (doctrine) that govern autonomous agents. This document describes the current technical architecture and the near-term direction implied by the existing codebase.

The project is still a prototype, but the implementation has moved beyond the original M1-only shape: working memory, episodic memory, per-agent doctrine versioning, tower-based doctrine sync, threats, and hard death are all present in code.

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Backend actors | [RivetKit](https://rivet.dev) | Stateful actor runtime |
| Server transport | Hono + `@hono/node-server` | Local HTTP entrypoint for Rivet handler |
| Frontend | React 19 + Vite | Map, doctrine editor, debrief UI |
| Shared types | TypeScript | Server/client contract |
| Monorepo | pnpm workspaces | `server/`, `client/`, `shared/` |

## Project Structure

```text
doctrine/
├── shared/src/index.ts            # Shared types, default doctrine, schema
├── server/src/
│   ├── actors/
│   │   ├── game-world.ts          # Main actor and authoritative game state
│   │   └── registry.ts            # RivetKit registry
│   ├── engine/
│   │   ├── agent-logic.ts         # Deterministic agent decisions + threat logic
│   │   └── map-generator.ts       # Seeded map generation
│   └── index.ts                   # Hono server entrypoint
├── client/src/
│   ├── components/
│   │   ├── MapView.tsx            # SVG world rendering
│   │   ├── DoctrineEditor.tsx     # JSON editor
│   │   ├── TickDebriefPanel.tsx   # Tick notices + memory panel
│   │   ├── GameControls.tsx       # Tick/start/stop/reset controls
│   │   └── Header.tsx             # Top status UI
│   ├── rivet.ts                   # RivetKit React client setup
│   └── App.tsx                    # Client event wiring and local auto-tick
├── HANDOFF.md                     # Current-state engineering handoff
├── CLAUDE.md                      # Development guardrails
└── .agents/skills/                # Local skills/reference material
```

## Current Architecture Decisions

### 1. Single actor world model

`gameWorld` is still the only gameplay actor. It owns map state, agents, threats, doctrine, doctrine history, known resources, towers, and debrief history.

This remains the simplest correct model for the current prototype. Do not split actors until there is a concrete milestone need.

### 2. Shared types are the contract

`shared/src/index.ts` is the source of truth for:

- `Doctrine`
- `GameState`
- `Agent`
- `Threat`
- `Tower`
- `TickDebrief`

When implementation and docs disagree, the shared contract plus the actor code wins.

### 3. Deterministic decision layer

Agent decision logic is still deterministic and server-side. The engine computes actions first, then applies mutations afterward.

Important consequences:

- map generation stays seeded/deterministic
- replay remains possible later
- memory and versioning can evolve without moving logic to the client

### 4. Client is a UI, but ticking is not yet server-owned

The intended architecture is actor-owned simulation, but current runtime control is transitional:

- single ticks are triggered from the client via `executeTick()`
- auto-tick is currently a client `setInterval` in `client/src/App.tsx`
- the actor already contains server-side tick-control actions, but the UI does not use them

This is an explicit architecture gap, not a desired final state.

### 5. Doctrine is versioned per deploy

Every deploy increments doctrine version. Each agent tracks `deployedDoctrineVersion` and may continue running an older version until it re-enters tower range.

The server stores a capped doctrine history array for correct agent-side resolution. The client only receives `previousDoctrine` for display, which is enough for basic stale indicators but not for perfect rendering of deeply stale agents.

### 6. Tower sync is radius-based, not wave-based

Current tower behavior is simple:

- base tower exists at the base position
- doctrine updates apply immediately to agents in `broadcastRadius`
- stale agents re-sync when they later enter range

Wave propagation, pulse timing, tower construction, and conflict resolution are not implemented yet.

### 7. Threats are hazards more than full combat units

Threats spawn, move toward agents, and deal contact damage. Defenders can chase them, but agents do not yet have a fully implemented attack/removal path against threats.

That means the threat model currently supports pressure and hard death, but not complete combat resolution.

## Current Runtime Flow

```text
Player edits doctrine JSON
  -> deployDoctrine() RPC
  -> server increments version and normalizes doctrine
  -> in-range agents sync immediately via tower radius
  -> broadcast("doctrineDeployed")

Player clicks TICK or client auto-tick fires
  -> executeTick() RPC
  -> server runs deterministic decision phase for all agents
  -> actions mutate state
  -> threats move and deal damage
  -> episodic memory updates apply
  -> debrief generated
  -> broadcast("tickCompleted")
  -> client re-renders map + debrief
```

## Current Gameplay Systems In Code

### Working memory

Agents persist task intent across ticks instead of re-evaluating from scratch every turn.

### Episodic memory

Agents retain significant observations with trimming and decay rules per role.

### Scout intel

Scouts can add resource positions to shared known-resource state, which gatherers can use.

### Doctrine version skew

Different agents may be on different doctrine versions at the same time. The client surfaces this through stale markers and debrief warnings.

### Hard death

Agents can die permanently, and their episodic memory is lost with them.

## Known Architecture Gaps

These are important because future work should not accidentally assume they are solved:

1. Auto-tick is still client-driven rather than server-authoritative.
2. Doctrine validation is still lenient in practice despite the presence of `DOCTRINE_SCHEMA`.
3. Client doctrine-history visibility is incomplete for agents more than one version behind.
4. Threat combat is one-sided.
5. Recovery spawning after hard death is not implemented.
6. Micro/macro tick separation is still design intent, not code reality.

## Near-Term Direction

The most valuable next architectural steps are:

1. Move tick ownership fully to the server.
2. Add recovery spawning so hard death does not end sessions permanently.
3. Tighten doctrine validation at deploy boundaries.
4. Update client/server stale-doctrine representation so UI remains correct as version history grows.

## Reference Docs

- `HANDOFF.md` - best current summary of shipped vs planned behavior
- `CLAUDE.md` - guardrails and coding constraints
- GitHub issues - execution queue for architecture gaps and follow-up work
