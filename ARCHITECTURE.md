# Doctrine — Architecture

## Overview

Doctrine is a strategy game where players write instruction systems (doctrine) that govern autonomous AI agents. This document describes the technical architecture for the prototype (Milestone 1).

## Tech Stack

| Layer          | Technology                    | Purpose                                                  |
| -------------- | ----------------------------- | -------------------------------------------------------- |
| Backend actors | [RivetKit](https://rivet.dev) | Stateful actors with real-time WebSocket communication   |
| Frontend       | React 19 + Vite               | UI for map visualization, doctrine editing, tick debrief |
| Shared types   | TypeScript                    | Type-safe contract between server and client             |
| Monorepo       | npm workspaces                | `server/`, `client/`, `shared/` packages                 |

## Project Structure

```
doctrine/
├── shared/src/           # Shared TypeScript types and constants
│   └── index.ts          # All shared types: GameState, Doctrine, Agent, Map, etc.
├── server/src/
│   ├── actors/
│   │   ├── game-world.ts # Main RivetKit actor — owns all game state
│   │   └── registry.ts   # Actor registry and server setup
│   ├── engine/
│   │   ├── agent-logic.ts # Deterministic agent decision logic (Tier 0)
│   │   └── map-generator.ts # Seeded procedural map generation
│   └── index.ts          # Server entry point
├── client/src/
│   ├── components/
│   │   ├── MapView.tsx      # SVG grid map with agent visualization
│   │   ├── DoctrineEditor.tsx # JSON doctrine editor with validation
│   │   ├── TickDebriefPanel.tsx # Post-tick action log
│   │   ├── GameControls.tsx   # Tick, start/stop, reset, speed
│   │   └── Header.tsx         # Status bar
│   ├── styles/
│   │   └── index.css       # Global styles (military briefing aesthetic)
│   ├── rivet.ts            # RivetKit React client setup
│   ├── App.tsx             # Main app component
│   └── main.tsx            # React entry point
└── .agents/skills/        # RivetKit AI development skills
```

## Architecture Decisions

### Single Actor Model (Milestone 1)

The `gameWorld` actor owns all game state for a session. This is intentionally simple for the prototype. Future milestones will split into:

- Per-agent actors (when memory tiers are introduced in M2)
- Map chunk actors (when shared map / PvP is introduced in M3)
- Matchmaking actor (M9)

### Doctrine as JSON

Milestone 1 uses raw JSON for doctrine authoring. This validates the core loop before investing in a richer editor. The `Doctrine` type in `shared/` is the schema contract.

### Client-Driven Tick Loop

Auto-tick is driven by `setInterval` on the client calling `executeTick()` via RPC. This is simple and correct for single-player. Server-driven ticks will be needed for multiplayer (M9).

### Deterministic Agents (Tier 0)

All agent logic is pure functions of `(agent, doctrine, map, tick) -> action`. No randomness, no memory. This is the "stateless" baseline from the design doc. Agents will gain memory in M2.

## Key Patterns

### State Flow

```
Player edits doctrine JSON
  -> deployDoctrine() RPC
  -> Actor updates state
  -> broadcast("doctrineDeployed")

Player clicks TICK (or auto-tick fires)
  -> executeTick() RPC
  -> Engine runs all agents deterministically
  -> Actions applied to mutable state
  -> Debrief generated
  -> broadcast("tickCompleted")
  -> React re-renders map + debrief
```

### Agent Decision Priority

- **Gatherer**: deposit if full -> gather if on resource -> move to nearest resource -> idle
- **Scout**: patrol pattern based on doctrine config -> linger at position -> move
- **Defender**: return to guard radius if too far -> hold position

## Guardrails for Future Work

1. **All game state lives in actors** — no client-side game state beyond UI concerns
2. **Types are the contract** — `shared/` types must be updated before server or client changes
3. **Agent logic is pure** — `executeAgent()` takes inputs, returns actions. No side effects.
4. **Actions are applied separately** — decision and mutation are distinct phases (important for replay in M8)
5. **Doctrine is versioned** — every deploy increments version. Agents carry their deploy version (Fog of Self, M6)
6. **Map generation is seeded** — same seed = same map, always (important for replay)
7. **Events, not polling** — use RivetKit broadcast/events for all state updates to clients
