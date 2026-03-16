import type {
  Agent,
  AgentAction,
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
    // Clear working memory task if we're returning
    if (agent.workingMemory.currentTask !== "return") {
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
        to: base,
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
    pendingEpisodes.push({
      agentId: agent.id,
      record: {
        tick,
        eventType: "resource-depleted",
        position: target,
        detail: `Target at (${target.x}, ${target.y}) was depleted on arrival`,
      },
    });
    agent.workingMemory.currentTask = null;
    agent.workingMemory.taskTarget = null;
    agent.workingMemory.taskStartTick = null;
  }

  const validKnown = knownResources.filter((pos) => {
    const tile = map.tiles[pos.y]?.[pos.x];
    return tile?.type === "resource" && tile.resources > 0;
  });
  const knownTarget =
    validKnown.sort((a, b) => distance(agent.position, a) - distance(agent.position, b))[0] ?? null;

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
  newKnownResources: Position[],
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): AgentAction {
  const cfg = doctrine.scout;
  const base = doctrine.basePosition;

  // Report resources visible at current position
  if (cfg.reportResourceFinds) {
    for (let dy = -agent.visionRadius; dy <= agent.visionRadius; dy++) {
      for (let dx = -agent.visionRadius; dx <= agent.visionRadius; dx++) {
        const x = agent.position.x + dx;
        const y = agent.position.y + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (distance(agent.position, { x, y }) > agent.visionRadius) continue;
        const tile = map.tiles[y][x];
        if (tile.type === "resource" && tile.resources > 0) {
          const isNew = !newKnownResources.some((p) => p.x === x && p.y === y);
          if (isNew) {
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

  // Working memory: commit to patrol target to avoid constant micro-oscillation
  if (
    !agent.workingMemory.currentTask ||
    agent.workingMemory.currentTask === "patrol"
  ) {
    agent.workingMemory.currentTask = "patrol";
    agent.workingMemory.taskTarget = targetPos;
  }

  // Linger logic
  if (distance(agent.position, targetPos) <= 1 && tick % (cfg.lingerTicks + 1) !== 0) {
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

  const next = stepToward(agent.position, targetPos, map);
  return {
    agentId: agent.id,
    agentType: "scout",
    action: "move",
    reason: `Patrolling (${cfg.patrolPattern}) toward (${targetPos.x}, ${targetPos.y})`,
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

  // Check for nearby threats within vision radius
  const visibleThreat = findNearestThreat(agent.position, threats, agent.visionRadius);

  if (visibleThreat) {
    const threatDist = distance(agent.position, visibleThreat.position);

    // Record threat sighting as episode if not already recorded recently
    const recentSpot = agent.episodes.some(
      (e) =>
        e.eventType === "threat-spotted" &&
        e.position.x === visibleThreat.position.x &&
        e.position.y === visibleThreat.position.y &&
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
      // Commit to chasing via working memory
      agent.workingMemory.currentTask = "chase";
      agent.workingMemory.taskTarget = visibleThreat.position;
      agent.workingMemory.taskStartTick ??= tick;

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
  } else if (agent.workingMemory.currentTask === "chase") {
    // Lost sight of threat — clear working memory
    agent.workingMemory.currentTask = null;
    agent.workingMemory.taskTarget = null;
    agent.workingMemory.taskStartTick = null;
  }

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
      return executeScout(agent, doctrine, map, tick, newKnownResources, pendingEpisodes);
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
): void {
  // Group pending episodes by agent
  const byAgent = new Map<string, EpisodeRecord[]>();
  for (const { agentId, record } of pendingEpisodes) {
    if (!byAgent.has(agentId)) byAgent.set(agentId, []);
    byAgent.get(agentId)!.push(record);
  }

  for (const agent of agents) {
    const newEpisodes = byAgent.get(agent.id) ?? [];
    const memCfg = getMemoryConfig(agent.type, doctrine);

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

function getMemoryConfig(type: string, doctrine: Doctrine): MemoryConfig {
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

/** Move a threat one step toward the nearest agent. Returns true if threat hit something. */
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

/** Deal damage from threats to agents on same tile. Returns list of killed agent IDs. */
export function applyThreatDamage(
  threats: Threat[],
  agents: Agent[],
  tick: number,
  pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }>,
): string[] {
  const killed: string[] = [];

  for (const threat of threats) {
    for (const agent of agents) {
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
          killed.push(agent.id);
        }
      }
    }
  }

  return killed;
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
