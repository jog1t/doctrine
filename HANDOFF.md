# Doctrine - Project Handoff

**Audience:** Claude Code / future coding agents
**Repo state date:** 2026-03-18
**Purpose:** Describe the codebase as it actually exists today, separate shipped behavior from planned work, and call out known inconsistencies that should not be mistaken for finished architecture.

---

## Executive Summary

Doctrine is still a single-actor, single-player prototype built with RivetKit actors on the server and React on the client.

Code reality is ahead of the repo's older milestone docs:

- M1 is no longer the full story in code.
- M2 features are partially shipped in the implementation.
- M2.5 is not shipped.
- Several repo docs still describe older architecture and should not be treated as authoritative without checking code.

If code and docs disagree, trust:

1. `shared/src/index.ts`
2. `server/src/actors/game-world.ts`
3. `server/src/engine/agent-logic.ts`
4. `client/src/App.tsx`
5. `client/src/components/MapView.tsx`
6. `client/src/components/TickDebriefPanel.tsx`

---

## Current Runtime Reality

### What is actually implemented

- One `gameWorld` actor owns all game state.
- The client initializes the world, but the `gameWorld` actor now owns auto-tick scheduling.
- Agents have working memory and episodic memory.
- Doctrine is versioned per deploy.
- Agents carry `deployedDoctrineVersion` and may run stale doctrine until they enter tower range.
- A base tower exists at `basePosition` and synchronizes doctrine within a fixed radius.
- Threats spawn periodically, move toward agents, and deal contact damage.
- Hard death is implemented: dead agents are removed and lose episodic memory permanently.
- The client shows map state, towers, threats, stale-doctrine indicators, debrief notices, and an inline memory panel.

### What is not implemented yet

- Server-authoritative ticking.
- Micro/macro tick separation.
- Spawn/replacement logic for dead agents.
- Wave-based doctrine propagation.
- Tower construction, capture, destruction, or conflict resolution.
- Shared/perceived map split.
- Deception mechanics.
- LLM-driven tactical or strategic layers.
- Full multiplayer support.

---

## Repo Layout That Matters

- `shared/src/index.ts` - current shared contract and default doctrine
- `server/src/actors/game-world.ts` - actor state, deploy flow, tick execution, doctrine history, tower sync
- `server/src/engine/agent-logic.ts` - deterministic decisions, working memory, episodic memory, threat movement and damage
- `server/src/__tests__/agent-logic.test.ts` - behavior coverage for M2 mechanics
- `client/src/App.tsx` - connection setup and tick control UI wired to actor actions
- `client/src/components/MapView.tsx` - map, towers, threats, stale markers, memory rings
- `client/src/components/TickDebriefPanel.tsx` - notices, stale version UI, inline memory panel
- `client/src/components/DoctrineEditor.tsx` - JSON editing and light validation only

---

## Shipped In Code

### Agent memory

- Tier 1 working memory exists for gatherers, scouts, and defenders.
- Tier 2 episodic memory exists with event types:
  - `resource-found`
  - `resource-depleted`
  - `task-completed`
  - `threat-spotted`
  - `damage-taken`
- Memory decay and trimming are configured per role via doctrine memory config.

### Doctrine versioning and propagation

- Every deploy increments doctrine version on the server.
- Agents keep their own `deployedDoctrineVersion`.
- The server stores a capped doctrine history as an array of `{ version, doctrine }` entries, not a keyed map.
- On deploy, only agents within tower `broadcastRadius` update immediately.
- On later ticks, stale agents update when they enter tower range.
- The client receives a capped `doctrineHistory` render summary containing only stale-UI fields it actually needs.

### Threats and death

- Threats spawn every 20 ticks up to a max of 3.
- Threats path toward the nearest agent.
- Threats deal 1 damage on contact.
- Dead agents are removed from the world.
- Debrief emits `FALLEN` notices.

### UI/debrief features

- Map renders towers, tower broadcast radius rings, threats, stale doctrine dots, stacked agents, carry counts, and HP bars.
- Debrief renders notices including `REDUNDANT`, `FALLEN`, `SYNC`, and version-skew messaging.
- Clicking a row can expand an inline memory panel showing working memory and recent episodes.

---

## Current Doctrine Shape In Code

The shared `Doctrine` type currently includes:

- `version`
- `name`
- `gatherer`
  - `searchRadius`
  - `returnThreshold`
  - `preferClosest`
  - `preferScoutIntel`
  - `memory`
- `scout`
  - `patrolRadius`
  - `patrolPattern`: `grid | spiral | perimeter`
  - `lingerTicks`
  - `reportResourceFinds`
  - `memory`
- `defender`
  - `guardRadius`
  - `chaseThreats`
  - `maxChaseDistance`
  - `memory`
- `basePosition`

Not in the live shared schema yet:

- `deployment`
- `targetComposition`
- `maxAgents`
- `towers` doctrine config
- `conflictPolicy`
- any M3+ deception or shard fields

Do not implement against speculative schema unless `shared/src/index.ts` is updated first.

---

## Important Caveats

### Ticking is server-scheduled inside the single world actor

- `client/src/App.tsx` no longer owns a browser `setInterval` for auto-tick.
- `server/src/actors/game-world.ts` schedules the next tick only after the current tick finishes.
- Scheduled ticks carry a generation token so stale callbacks from an older start/stop/interval change are ignored.
- This avoids overlap inside the current single-actor architecture: tick N+1 is not scheduled until tick N completes.
- This is not yet a multiplayer barrier system. If gameplay is later split across multiple actors or players, a coordinator/ack protocol will still be required so tick N+1 does not begin before every participant has finished tick N.

### Validation is weaker than the schema suggests

- `DOCTRINE_SCHEMA` exists in `shared/src/index.ts`.
- The editor only does JSON parsing plus minimal required-field checks.
- The server normalizes missing fields instead of enforcing strict schema validation on deploy.

### Client visibility into doctrine history is partial

- Server logic can resolve agents more than one version behind using `doctrineHistory`.
- The client now receives a capped `doctrineHistory` render summary window, so UI can resolve recently stale agents accurately without pulling full historical doctrine payloads.
- UI still falls back to a neutral display if an agent somehow references a version older than the capped client history.

### Threat combat is one-sided today

- Threats can damage agents.
- Defenders can chase threats.
- No agent attack/damage/removal path for threats is implemented yet.
- In practice, threats are persistent hazards rather than fully modeled combatants.

---

## Known Docs Drift

These files currently lag behind the code and should be treated cautiously:

- `CLAUDE.md`
  - still says the project is at M1
  - still documents older RivetKit patterns like `registry.serve()` and typed `createRivetKit<typeof registry>`
- `README.md`
  - still says current implementation is M1
- `ARCHITECTURE.md`
  - still frames the project as Milestone 1 architecture
  - still mentions npm workspaces instead of pnpm

This handoff exists partly to bridge that gap until those docs are updated.

---

## Recommended Next Work

### M2.5a - make sessions recoverable

Highest-value next milestone:

- add deployment/spawn schema to `shared/src/index.ts`
- implement replacement spawning from base
- surface spawn queue in the debrief/UI
- define threat/combat behavior clearly enough to test sustained play

### Infrastructure cleanup that should happen soon

- validate the new server-driven tick scheduling under longer play sessions
- align repo docs with current code reality
- strengthen doctrine validation on deploy
- validate whether the current capped doctrine history window is sufficient for UI needs
- design an explicit multiplayer tick barrier/coordinator before actor decomposition

### Defer until after M2.5a unless required

- wave propagation
- tower construction/capture/destruction
- multi-owner conflict policy
- shared/perceived map split
- deception mechanics

---

## Validation Checklist For Future Handoffs

Before claiming a feature is shipped:

- verify schema in `shared/src/index.ts`
- verify actor/state flow in `server/src/actors/game-world.ts`
- verify engine behavior in `server/src/engine/agent-logic.ts`
- verify UI claims in `client/src/components/MapView.tsx` and `client/src/components/TickDebriefPanel.tsx`
- verify runtime control flow in `client/src/App.tsx`
- distinguish `Shipped`, `Planned Next`, and `Design Only`
- call out any docs that are stale relative to code

---

## Bottom Line

The project is best described as:

**M2 mechanics partially shipped in code, but surrounding docs still read like M1, and M2.5 recovery/infrastructure work is still required before the prototype supports sustained sessions cleanly.**
