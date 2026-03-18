import type {
  Agent,
  AgentAction,
  AgentType,
  Doctrine,
  EpisodeRecord,
  GameMap,
  MemoryConfig,
  Position,
  Threat,
} from "@doctrine/shared";

// --- Utility ---

function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); // Manhattan distance
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Move one step toward target, trying both axes and sidestepping if blocked. */
function stepToward(from: Position, to: Position, map?: GameMap): Position {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  // Primary: prefer axis with larger distance
  const primary: Position =
    Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
      ? { x: from.x + dx, y: from.y }
      : { x: from.x, y: from.y + dy };

  if (!map || isPassable(map, primary)) return primary;

  // Secondary: try the other axis
  const secondary: Position =
    Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
      ? { x: from.x, y: from.y + dy }
      : { x: from.x + dx, y: from.y };

  if (isPassable(map, secondary)) return secondary;

  // Sidestep perpendicular to try to get around the obstacle
  if (dx !== 0 && isPassable(map, { x: from.x, y: from.y + 1 })) return { x: from.x, y: from.y + 1 };
  if (dx !== 0 && isPassable(map, { x: from.x, y: from.y - 1 })) return { x: from.x, y: from.y - 1 };
  if (dy !== 0 && isPassable(map, { x: from.x + 1, y: from.y })) return { x: from.x + 1, y: from.y };
  if (dy !== 0 && isPassable(map, { x: from.x - 1, y: from.y })) return { x: from.x - 1, y: from.y };

  return from; // truly stuck
}

function isPassable(map: GameMap, pos: Position): boolean {
  if (pos.x < 0 || pos.x >= map.width || pos.y < 0 || pos.y >= map.height) {
    return false;
  }
  return map.tiles[pos.y][pos.x].type !== "obstacle";
}

function findNearestResource(
  map: GameMap,
  from: Position,
  radius: number,
  preferClosest: boolean,
): Position | null {
  let best: Position | null = null;
  let bestScore = Infinity;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = from.x + dx;
      const y = from.y + dy;
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;

      const tile = map.tiles[y][x];
      if (tile.type === "resource" && tile.resources > 0) {
        const dist = distance(from, { x, y });
        const score = preferClosest ? dist : -tile.resources;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
  }

  return best;
}

function findNearestThreat(from: Position, threats: Threat[], maxRange: number): Threat | null {
  let nearest: Threat | null = null;
  let nearestDist = Infinity;
  for (const t of threats) {
    const d = distance(from, t.position);
    if (d <= maxRange && d < nearestDist) {
      nearestDist = d;
      nearest = t;
    }
  }
  return nearest;
}

// --- Agent Logic (Tier 1: Working Memory + Tier 2: Episodic Memory) ---

function executeGatherer(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  knownResources: Position[],
  tick: number,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): AgentAction {
  const cfg = doctrine.gatherer;
  const base = doctrine.basePosition;

  // If carrying enough, return to base
  if (agent.carrying >= cfg.returnThreshold) {
    // Update working memory when task changes OR when base has moved (doctrine redeploy)
    const baseChanged =
      agent.workingMemory.taskTarget === null ||
      agent.workingMemory.taskTarget.x !== base.x ||
      agent.workingMemory.taskTarget.y !== base.y;
    if (agent.workingMemory.currentTask !== "return" || baseChanged) {
      agent.workingMemory.currentTask = "return";
      agent.workingMemory.taskTarget = base;
      agent.workingMemory.taskStartTick = tick;
    }
    if (distance(agent.position, base) <= 1) {
      agent.workingMemory.currentTask = null;
      agent.workingMemory.taskTarget = null;
      agent.workingMemory.taskStartTick = null;
      return {
        agentId: agent.id,
        agentType: "gatherer",
        action: "deposit",
        reason: `Carrying ${agent.carrying} resources, at base — depositing`,
        from: agent.position,
        to: null,
        doctrineVersion: doctrine.version,
      };
    }
    const next = stepToward(agent.position, base, map);
    return {
      agentId: agent.id,
      agentType: "gatherer",
      action: "move",
      reason: `Carrying ${agent.carrying}/${cfg.returnThreshold}, returning to base`,
      from: agent.position,
      to: next,
      doctrineVersion: doctrine.version,
    };
  }

  // If on a resource tile, gather
  const currentTile = map.tiles[agent.position.y][agent.position.x];
  if (currentTile.type === "resource" && currentTile.resources > 0) {
    return {
      agentId: agent.id,
      agentType: "gatherer",
      action: "gather",
      reason: `Resource found at current position (${currentTile.resources} remaining)`,
      from: agent.position,
      to: null,
      doctrineVersion: doctrine.version,
    };
  }

  // Check if working memory has a committed target
  if (agent.workingMemory.currentTask === "gather" && agent.workingMemory.taskTarget) {
    const target = agent.workingMemory.taskTarget;
    const targetTile = map.tiles[target.y]?.[target.x];
    if (targetTile?.type === "resource" && targetTile.resources > 0) {
      // Still valid — commit to it
      const next = stepToward(agent.position, target, map);
      return {
        agentId: agent.id,
        agentType: "gatherer",
        action: "move",
        reason: `Committed to resource at (${target.x}, ${target.y}) [working memory]`,
        from: agent.position,
        to: next,
        doctrineVersion: doctrine.version,
      };
    }
    // Target depleted — record episode, clear working memory
    const atTarget = distance(agent.position, target) <= 1;
    pendingEpisodes.push({
      agentId: agent.id,
      record: {
        tick,
        eventType: "resource-depleted",
        position: target,
        detail: atTarget
          ? `Target at (${target.x}, ${target.y}) was depleted on arrival`
          : `Target at (${target.x}, ${target.y}) was depleted while en route`,
      },
    });
    agent.workingMemory.currentTask = null;
    agent.workingMemory.taskTarget = null;
    agent.workingMemory.taskStartTick = null;
  }

  // Linear scan — avoids allocating a sorted copy just to pick the nearest entry
  let knownTarget: Position | null = null;
  let knownTargetDist = Infinity;
  for (const pos of knownResources) {
    const tile = map.tiles[pos.y]?.[pos.x];
    if (tile?.type !== "resource" || tile.resources <= 0) continue;
    const d = distance(agent.position, pos);
    if (d < knownTargetDist) {
      knownTargetDist = d;
      knownTarget = pos;
    }
  }

  // Pick a new target (preferScoutIntel first or local first)
  let pickedTarget: Position | null = null;
  let targetSource = "";

  if (cfg.preferScoutIntel && knownTarget) {
    pickedTarget = knownTarget;
    targetSource = "intel";
  } else {
    const localTarget = findNearestResource(map, agent.position, cfg.searchRadius, cfg.preferClosest);
    if (localTarget) {
      pickedTarget = localTarget;
      targetSource = "scan";
    } else if (knownTarget) {
      pickedTarget = knownTarget;
      targetSource = "intel";
    }
  }

  if (pickedTarget) {
    // Commit to target via working memory
    agent.workingMemory.currentTask = "gather";
    agent.workingMemory.taskTarget = pickedTarget;
    agent.workingMemory.taskStartTick = tick;
    const next = stepToward(agent.position, pickedTarget, map);
    const actionType = targetSource === "intel" ? "move-intel" : "move";
    const reasonPrefix = targetSource === "intel" ? "Intel" : "Scan";
    return {
      agentId: agent.id,
      agentType: "gatherer",
      action: actionType,
      reason: `${reasonPrefix}: heading to resource at (${pickedTarget.x}, ${pickedTarget.y})`,
      from: agent.position,
      to: next,
      doctrineVersion: doctrine.version,
    };
  }

  return {
    agentId: agent.id,
    agentType: "gatherer",
    action: "idle",
    reason: `No resources within search radius ${cfg.searchRadius} and no scout reports`,
    from: agent.position,
    to: null,
    doctrineVersion: doctrine.version,
  };
}

function executeScout(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  tick: number,
  knownResources: Position[],
  newKnownResources: Position[],
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): AgentAction {
  const cfg = doctrine.scout;
  const base = doctrine.basePosition;

  // Report resources visible at current position
  if (cfg.reportResourceFinds) {
    // Precompute known-position set for O(1) membership checks inside the vision loop
    const knownSet = new Set<string>();
    for (const p of knownResources) knownSet.add(`${p.x},${p.y}`);
    for (const p of newKnownResources) knownSet.add(`${p.x},${p.y}`);

    for (let dy = -agent.visionRadius; dy <= agent.visionRadius; dy++) {
      for (let dx = -agent.visionRadius; dx <= agent.visionRadius; dx++) {
        const x = agent.position.x + dx;
        const y = agent.position.y + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (distance(agent.position, { x, y }) > agent.visionRadius) continue;
        const tile = map.tiles[y][x];
        if (tile.type === "resource" && tile.resources > 0) {
          const key = `${x},${y}`;
          if (!knownSet.has(key)) {
            knownSet.add(key); // mark immediately so sibling loops don't double-report
            newKnownResources.push({ x, y });
            // Record as episode
            pendingEpisodes.push({
              agentId: agent.id,
              record: {
                tick,
                eventType: "resource-found",
                position: { x, y },
                detail: `Found resource node at (${x}, ${y}) with ${tile.resources} units`,
              },
            });
          }
        }
      }
    }
  }

  // Patrol logic
  let targetPos: Position;

  if (cfg.patrolPattern === "grid") {
    const scoutIndex = parseInt(agent.id.split("-")[1] || "0");
    const cols = 2;
    const sectorW = Math.floor(map.width / cols);
    const sectorH = Math.floor(map.height / 2);
    const col = scoutIndex % cols;
    const row = Math.floor(scoutIndex / cols) % 2;
    const sectorX = col * sectorW;
    const sectorY = row * sectorH;

    const cellsInSector = sectorW * sectorH;
    const cellIndex = (tick + hashString(agent.id)) % cellsInSector;
    const localRow = Math.floor(cellIndex / sectorW);
    const localCol = localRow % 2 === 0 ? cellIndex % sectorW : sectorW - 1 - (cellIndex % sectorW);
    targetPos = {
      x: clamp(sectorX + localCol, 0, map.width - 1),
      y: clamp(sectorY + localRow, 0, map.height - 1),
    };
  } else if (cfg.patrolPattern === "perimeter") {
    const perimeterLength = cfg.patrolRadius * 8;
    const pos = (tick + hashString(agent.id)) % perimeterLength;
    const side = Math.floor(pos / (perimeterLength / 4));
    const progress = (pos % (perimeterLength / 4)) / (perimeterLength / 4);

    const r = cfg.patrolRadius;
    switch (side) {
      case 0:
        targetPos = { x: base.x - r + progress * 2 * r, y: base.y - r };
        break;
      case 1:
        targetPos = { x: base.x + r, y: base.y - r + progress * 2 * r };
        break;
      case 2:
        targetPos = { x: base.x + r - progress * 2 * r, y: base.y + r };
        break;
      default:
        targetPos = { x: base.x - r, y: base.y + r - progress * 2 * r };
        break;
    }
    targetPos = {
      x: clamp(Math.round(targetPos.x), 0, map.width - 1),
      y: clamp(Math.round(targetPos.y), 0, map.height - 1),
    };
  } else {
    // Spiral
    const spiralTick = tick + hashString(agent.id);
    const radius = (spiralTick % cfg.patrolRadius) + 1;
    const angle = (spiralTick * 0.5) % (2 * Math.PI);
    targetPos = {
      x: clamp(Math.round(base.x + Math.cos(angle) * radius), 0, map.width - 1),
      y: clamp(Math.round(base.y + Math.sin(angle) * radius), 0, map.height - 1),
    };
  }

  // Working memory: commit to a new patrol target only when starting fresh or the previous target was reached.
  // targetPos (computed from tick + pattern) is only used to pick the next waypoint to commit to.
  const atTarget =
    agent.workingMemory.taskTarget !== null &&
    distance(agent.position, agent.workingMemory.taskTarget) <= 1;
  if (!agent.workingMemory.currentTask || agent.workingMemory.currentTask !== "patrol" || !agent.workingMemory.taskTarget || atTarget) {
    agent.workingMemory.currentTask = "patrol";
    agent.workingMemory.taskTarget = targetPos;
    agent.workingMemory.taskStartTick = tick;
  }

  // Use the committed target for all movement — not the freshly recomputed targetPos.
  const committedTarget = agent.workingMemory.taskTarget!;

  // Linger logic
  if (distance(agent.position, committedTarget) <= 1 && tick % (cfg.lingerTicks + 1) !== 0) {
    return {
      agentId: agent.id,
      agentType: "scout",
      action: "observe",
      reason: `Observing area around (${agent.position.x}, ${agent.position.y})`,
      from: agent.position,
      to: null,
      doctrineVersion: doctrine.version,
    };
  }

  const next = stepToward(agent.position, committedTarget, map);
  return {
    agentId: agent.id,
    agentType: "scout",
    action: "move",
    reason: `Patrolling (${cfg.patrolPattern}) toward (${committedTarget.x}, ${committedTarget.y})`,
    from: agent.position,
    to: next,
    doctrineVersion: doctrine.version,
  };
}

function executeDefender(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  threats: Threat[],
  tick: number,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): AgentAction {
  const cfg = doctrine.defender;
  const base = doctrine.basePosition;
  const distFromBase = distance(agent.position, base);

  const clearChaseMemory = () => {
    if (!agent.workingMemory.currentTask?.startsWith("chase:")) return;
    agent.workingMemory.currentTask = null;
    agent.workingMemory.taskTarget = null;
    agent.workingMemory.taskStartTick = null;
  };

  // Check for nearby threats within vision radius
  const visibleThreat = findNearestThreat(agent.position, threats, agent.visionRadius);

  if (visibleThreat) {
    const threatDist = distance(agent.position, visibleThreat.position);

    // Record threat sighting as episode if not already recorded recently.
    // Dedup by threat ID (via detail), not position — threats move each tick
    // so position-based matching would re-record the same threat every tick.
    const spotPrefix = `Spotted threat ${visibleThreat.id} `;
    const recentSpot = agent.episodes.some(
      (e) =>
        e.eventType === "threat-spotted" &&
        e.detail.startsWith(spotPrefix) &&
        tick - e.tick < 5,
    );
    if (!recentSpot) {
      pendingEpisodes.push({
        agentId: agent.id,
        record: {
          tick,
          eventType: "threat-spotted",
          position: visibleThreat.position,
          detail: `Spotted threat ${visibleThreat.id} at distance ${threatDist}`,
        },
      });
    }

    if (cfg.chaseThreats && threatDist <= cfg.maxChaseDistance) {
      // Commit to chasing via working memory; reset start tick only when switching to a different
      // threat. Compare by threat ID (not position) — threats move each tick so position-based
      // comparison would always fail, resetting taskStartTick on every tick.
      const chaseTask = `chase:${visibleThreat.id}`;
      const sameTarget = agent.workingMemory.currentTask === chaseTask;
      agent.workingMemory.currentTask = chaseTask;
      agent.workingMemory.taskTarget = visibleThreat.position;
      if (!sameTarget) agent.workingMemory.taskStartTick = tick;

      const next = stepToward(agent.position, visibleThreat.position, map);
      return {
        agentId: agent.id,
        agentType: "defender",
        action: "move",
        reason: `Engaging threat ${visibleThreat.id} at (${visibleThreat.position.x}, ${visibleThreat.position.y})`,
        from: agent.position,
        to: next,
        doctrineVersion: doctrine.version,
      };
    }
  }

  // If we are no longer actively chasing, stale chase memory should not survive into guard/return behavior.
  clearChaseMemory();

  // If too far from guard post, return
  if (distFromBase > cfg.guardRadius) {
    const next = stepToward(agent.position, base, map);
    return {
      agentId: agent.id,
      agentType: "defender",
      action: "move",
      reason: `Too far from base (${distFromBase} > ${cfg.guardRadius}), returning`,
      from: agent.position,
      to: next,
      doctrineVersion: doctrine.version,
    };
  }

  return {
    agentId: agent.id,
    agentType: "defender",
    action: "guard",
    reason: `Holding position within guard radius (${distFromBase}/${cfg.guardRadius})`,
    from: agent.position,
    to: null,
    doctrineVersion: doctrine.version,
  };
}

// --- Dispatch ---

export function executeAgent(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  tick: number,
  knownResources: Position[],
  newKnownResources: Position[],
  threats: Threat[],
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): AgentAction {
  switch (agent.type) {
    case "gatherer":
      return executeGatherer(agent, doctrine, map, knownResources, tick, pendingEpisodes);
    case "scout":
      return executeScout(agent, doctrine, map, tick, knownResources, newKnownResources, pendingEpisodes);
    case "defender":
      return executeDefender(agent, doctrine, map, threats, tick, pendingEpisodes);
  }
}

/** Apply an action's effects to the mutable game state. */
export function applyAction(
  action: AgentAction,
  agents: Agent[],
  map: GameMap,
  tick: number,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): number {
  const agent = agents.find((a) => a.id === action.agentId);
  if (!agent) return 0;

  let collected = 0;

  switch (action.action) {
    case "move":
    case "move-intel":
      if (action.to) {
        agent.position = { ...action.to };
        agent.status = "moving";
      }
      break;

    case "gather": {
      const tile = map.tiles[agent.position.y][agent.position.x];
      if (tile.type === "resource" && tile.resources > 0) {
        tile.resources -= 1;
        agent.carrying += 1;
        agent.status = "gathering";
        if (tile.resources === 0) {
          tile.type = "empty";
          // Clear gather working memory — target is gone; prevents a duplicate
          // resource-depleted episode on the next tick when executeGatherer would
          // see the committed target is empty and record it again.
          if (agent.workingMemory.currentTask === "gather") {
            agent.workingMemory.currentTask = null;
            agent.workingMemory.taskTarget = null;
            agent.workingMemory.taskStartTick = null;
          }
          // Record depletion episode
          pendingEpisodes.push({
            agentId: agent.id,
            record: {
              tick,
              eventType: "resource-depleted",
              position: { ...agent.position },
              detail: `Exhausted resource node at (${agent.position.x}, ${agent.position.y})`,
            },
          });
        }
      }
      break;
    }

    case "deposit":
      collected = agent.carrying;
      agent.carrying = 0;
      agent.status = "returning";
      pendingEpisodes.push({
        agentId: agent.id,
        record: {
          tick,
          eventType: "task-completed",
          position: { ...agent.position },
          detail: `Deposited ${collected} resources at base`,
        },
      });
      break;

    case "observe":
      agent.status = "scouting";
      break;

    case "guard":
      agent.status = "defending";
      break;

    case "idle":
      agent.status = "idle";
      break;
  }

  return collected;
}

/** Apply episodic memory updates and decay to all agents. */
export function applyMemoryUpdates(
  agents: Agent[],
  doctrine: Doctrine,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
  tick: number,
  doctrineHistory: Array<{ version: number; doctrine: Doctrine }>,
): void {
  // Group pending episodes by agent
  const byAgent = new Map<string, EpisodeRecord[]>();
  for (const { agentId, record } of pendingEpisodes) {
    if (!byAgent.has(agentId)) byAgent.set(agentId, []);
    byAgent.get(agentId)!.push(record);
  }

  for (const agent of agents) {
    const newEpisodes = byAgent.get(agent.id) ?? [];
    // Exact-version lookup: an agent 2+ versions behind finds the right config in history
    const agentDoctrine =
      agent.deployedDoctrineVersion === doctrine.version
        ? doctrine
        : (doctrineHistory.find((h) => h.version === agent.deployedDoctrineVersion)?.doctrine ?? doctrine);
    const memCfg = getMemoryConfig(agent.type, agentDoctrine);

    // Append new episodes
    agent.episodes.push(...newEpisodes);

    // Decay: drop episodes older than decayAfterTicks
    if (memCfg.decayAfterTicks > 0) {
      agent.episodes = agent.episodes.filter((e) => tick - e.tick <= memCfg.decayAfterTicks);
    }

    // Trim to maxEpisodes (keep most recent)
    if (memCfg.maxEpisodes > 0 && agent.episodes.length > memCfg.maxEpisodes) {
      agent.episodes = agent.episodes.slice(-memCfg.maxEpisodes);
    }
  }
}

function getMemoryConfig(type: AgentType, doctrine: Doctrine): MemoryConfig {
  switch (type) {
    case "gatherer":
      return doctrine.gatherer.memory;
    case "scout":
      return doctrine.scout.memory;
    case "defender":
      return doctrine.defender.memory;
    default:
      return { maxEpisodes: 10, decayAfterTicks: 30 };
  }
}

/** Move a threat one step toward the nearest agent (modifies threat in place). */
export function moveThreat(threat: Threat, agents: Agent[], map: GameMap): void {
  if (agents.length === 0) return;

  // Find nearest agent
  let nearest = agents[0];
  let nearestDist = distance(threat.position, agents[0].position);
  for (const a of agents) {
    const d = distance(threat.position, a.position);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = a;
    }
  }

  if (nearestDist === 0) return; // already on same tile
  threat.position = stepToward(threat.position, nearest.position, map);
}

/** Deal damage from threats to agents on same tile. Returns list of killed agent IDs (deduplicated). */
export function applyThreatDamage(
  threats: Threat[],
  agents: Agent[],
  tick: number,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): string[] {
  const killedSet = new Set<string>();

  for (const threat of threats) {
    for (const agent of agents) {
      if (killedSet.has(agent.id)) continue; // already dead this tick — skip further damage
      if (agent.position.x === threat.position.x && agent.position.y === threat.position.y) {
        agent.hp -= 1;
        pendingEpisodes.push({
          agentId: agent.id,
          record: {
            tick,
            eventType: "damage-taken",
            position: { ...agent.position },
            detail: `Took 1 damage from ${threat.id} (${agent.hp}/${agent.maxHp} HP remaining)`,
          },
        });
        if (agent.hp <= 0) {
          killedSet.add(agent.id);
        }
      }
    }
  }

  return Array.from(killedSet);
}

/**
 * Advance agents whose doctrine version has been evicted from history to currentVersion.
 * Without this, a stranded agent appears stale in the UI but silently executes with the
 * current doctrine config once its version falls out of the 5-entry history cap.
 */
export function advanceEvictedAgentVersions(
  agents: Agent[],
  currentVersion: number,
  history: Array<{ version: number; doctrine: Doctrine }>,
): void {
  const knownVersions = new Set([currentVersion, ...history.map((h) => h.version)]);
  for (const agent of agents) {
    if (!knownVersions.has(agent.deployedDoctrineVersion)) {
      agent.deployedDoctrineVersion = currentVersion;
    }
  }
}

/**
 * Spawn a threat at a passable edge tile. Mixes in the game seed so each fresh
 * game gets different spawn positions instead of always reusing the same spots.
 * Falls back through the remaining edges if all tiles on the chosen edge are
 * obstacles, so threats always spawn on a passable tile.
 */
export function spawnThreat(id: string, map: GameMap, seed: number): Threat {
  const hash = hashString(`${id}:${seed}`);
  const startEdge = hash % 4;

  function findPassableOnEdge(edge: number): { x: number; y: number } | null {
    const edgeLen = edge % 2 === 0 ? map.width : map.height;
    const startPos = hash % edgeLen;
    for (let i = 0; i < edgeLen; i++) {
      const pos = (startPos + i) % edgeLen;
      let x = 0;
      let y = 0;
      switch (edge) {
        case 0:
          x = pos;
          y = 0;
          break;
        case 1:
          x = map.width - 1;
          y = pos;
          break;
        case 2:
          x = pos;
          y = map.height - 1;
          break;
        default:
          x = 0;
          y = pos;
          break;
      }
      if (map.tiles[y][x].type !== "obstacle") return { x, y };
    }
    return null;
  }

  // Try the chosen edge first, then fall back through the other three in order
  for (let i = 0; i < 4; i++) {
    const pos = findPassableOnEdge((startEdge + i) % 4);
    if (pos) return { id, position: pos, hp: 3, maxHp: 3 };
  }

  // Pathological map: all edges are obstacles — fall back to (0,0)
  return { id, position: { x: 0, y: 0 }, hp: 3, maxHp: 3 };
}

// --- Helpers ---

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
