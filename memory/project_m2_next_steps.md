---
name: M2 status and next steps
description: Milestone 2 implementation status and what remains
type: project
---

M2 is implemented and typechecks clean.

**What was built:**
- Tier 1 Working Memory: agents commit to tasks across ticks (gatherers don't re-evaluate each tick if target still valid; defenders remember chase state; scouts track patrol target)
- Tier 2 Episodic Memory: agents accumulate EpisodeRecord[] for resource-found, resource-depleted, task-completed, threat-spotted, damage-taken events
- Memory decay: configurable `maxEpisodes` + `decayAfterTicks` per agent type in doctrine
- Tower broadcasting: 1 initial tower at base with radius 8; when doctrine is deployed, only in-range agents update immediately; out-of-range agents sync each tick as they enter tower range
- Per-agent doctrine versioning: each agent carries `deployedDoctrineVersion`; agents resolve their doctrine config via `doctrineHistory` (keyed by version, capped at 5 entries) so agents 2+ versions behind still use the right config; the client only receives a compact render-summary view of that history for stale UI; debrief shows version skew with orange indicator dot in MapView and "VERSION SKEW" warning in debrief
- Threats: hostile units spawn every 20 ticks (max 3 at once) at map edges, move toward nearest agent, deal 1 damage on contact
- Hard death: when agent hp <= 0, removed from game — episodic memory is gone; "FALLEN: agent-id" notice in debrief
- MapView: renders towers (T glyph), threat radius ring, threats (X glyph), memory load ring on agents (grows with experience), orange dot for stale doctrine version

**Why:** M2 core loop: agents gain experience, losing a veteran hurts, doctrine propagation has spatial cost.

**Follow-up adjustments before merge:**
- Gatherer deposit actions now use explicit `depositing` status so UI can distinguish a completed deposit from travel/return movement.
- `MapView` visual tokens now pull from shared CSS variables, and stacked-agent rendering is extracted into a dedicated `AgentMarkers` component instead of an inline IIFE.
- `TickDebriefPanel` action-row class assembly now uses `clsx` for clearer stateful styling logic.
- Auto-tick ownership moved into the single `gameWorld` actor. The actor self-schedules exactly one future tick at a time and only schedules tick `N+1` after tick `N` finishes. A generation token invalidates stale scheduled callbacks after stop/start/interval changes.
- Important future constraint for multiplayer: this is not a cross-actor barrier. If simulation is ever split across multiple actors or players, add a coordinator that advances the world only after all required participants acknowledge tick completion.

**Multiplayer tick-barrier options to revisit later:**
- Central coordinator actor: world coordinator issues tick `N`, waits for `tick-complete(N)` from each participant actor, then advances to tick `N+1`.
- Deadline + missing-participant policy: coordinator waits until all acks arrive or a timeout hits, then applies a defined fallback (`skip`, `last-known-input`, `pause-match`, or `drop-player`).
- Two-phase tick protocol: participants first compute/report decisions for tick `N`, then coordinator commits all mutations together so no actor can start `N+1` early.
- Tick token/idempotency guards: every tick message carries a tick number and generation token so duplicate or stale completions are ignored safely.

**How to apply:** Next milestone is M3 — shared map / basic deception (two-layer map: ground truth vs perceived, scout write channels, basic passive deception via false marker signals).
