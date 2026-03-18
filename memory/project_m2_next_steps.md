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
- Per-agent doctrine versioning: each agent carries `deployedDoctrineVersion`; agents resolve their doctrine config via `doctrineHistory` (keyed by version, capped at 5 entries) so agents 2+ versions behind still use the right config; `previousDoctrine` is UI-only (most recent prior doctrine for display); debrief shows version skew with orange indicator dot in MapView and "VERSION SKEW" warning in debrief
- Threats: hostile units spawn every 20 ticks (max 3 at once) at map edges, move toward nearest agent, deal 1 damage on contact
- Hard death: when agent hp <= 0, removed from game — episodic memory is gone; "FALLEN: agent-id" notice in debrief
- MapView: renders towers (T glyph), threat radius ring, threats (X glyph), memory load ring on agents (grows with experience), orange dot for stale doctrine version

**Why:** M2 core loop: agents gain experience, losing a veteran hurts, doctrine propagation has spatial cost.

**Follow-up adjustments before merge:**
- Gatherer deposit actions now use explicit `depositing` status so UI can distinguish a completed deposit from travel/return movement.
- `MapView` visual tokens now pull from shared CSS variables, and stacked-agent rendering is extracted into a dedicated `AgentMarkers` component instead of an inline IIFE.
- `TickDebriefPanel` action-row class assembly now uses `clsx` for clearer stateful styling logic.

**How to apply:** Next milestone is M3 — shared map / basic deception (two-layer map: ground truth vs perceived, scout write channels, basic passive deception via false marker signals).
