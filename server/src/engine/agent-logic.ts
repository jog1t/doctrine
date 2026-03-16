import type { Agent, AgentAction, Doctrine, GameMap, Position } from "@doctrine/shared";

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

// --- Agent Logic (Tier 0: Stateless, Deterministic) ---

function executeGatherer(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  knownResources: Position[],
): AgentAction {
  const cfg = doctrine.gatherer;
  const base = doctrine.basePosition;

  // If carrying enough, return to base
  if (agent.carrying >= cfg.returnThreshold) {
    if (distance(agent.position, base) <= 1) {
      return {
        agentId: agent.id,
        agentType: "gatherer",
        action: "deposit",
        reason: `Carrying ${agent.carrying} resources, at base — depositing`,
        from: agent.position,
        to: base,
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
    };
  }

  // Search for nearest resource
  const target = findNearestResource(map, agent.position, cfg.searchRadius, cfg.preferClosest);

  if (target) {
    const next = stepToward(agent.position, target, map);
    return {
      agentId: agent.id,
      agentType: "gatherer",
      action: "move",
      reason: `Moving toward resource at (${target.x}, ${target.y})`,
      from: agent.position,
      to: next,
    };
  }

  // Fall back to scout-reported known resources
  const knownTarget = knownResources
    .filter((pos) => {
      const tile = map.tiles[pos.y]?.[pos.x];
      return tile?.type === "resource" && tile.resources > 0;
    })
    .sort((a, b) => distance(agent.position, a) - distance(agent.position, b))[0] ?? null;

  if (knownTarget) {
    const next = stepToward(agent.position, knownTarget, map);
    return {
      agentId: agent.id,
      agentType: "gatherer",
      action: "move-intel",
      reason: `Intel: scout reported resource at (${knownTarget.x}, ${knownTarget.y})`,
      from: agent.position,
      to: next,
    };
  }

  return {
    agentId: agent.id,
    agentType: "gatherer",
    action: "idle",
    reason: `No resources within search radius ${cfg.searchRadius} and no scout reports`,
    from: agent.position,
    to: null,
  };
}

function executeScout(
  agent: Agent,
  doctrine: Doctrine,
  map: GameMap,
  tick: number,
  newKnownResources: Position[],
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
          newKnownResources.push({ x, y });
        }
      }
    }
  }

  // Patrol logic
  let targetPos: Position;

  if (cfg.patrolPattern === "grid") {
    // Divide map into sectors; each scout owns one by index and sweeps it systematically.
    const scoutIndex = parseInt(agent.id.split("-")[1] || "0");
    const cols = 2;
    const sectorW = Math.floor(map.width / cols);
    const sectorH = Math.floor(map.height / 2);
    const col = scoutIndex % cols;
    const row = Math.floor(scoutIndex / cols) % 2;
    const sectorX = col * sectorW;
    const sectorY = row * sectorH;

    // Walk sector in a boustrophedon (snake) pattern based on tick
    const cellsInSector = sectorW * sectorH;
    const cellIndex = (tick + hashString(agent.id)) % cellsInSector;
    const localRow = Math.floor(cellIndex / sectorW);
    const localCol = localRow % 2 === 0 ? cellIndex % sectorW : sectorW - 1 - (cellIndex % sectorW);
    targetPos = {
      x: clamp(sectorX + localCol, 0, map.width - 1),
      y: clamp(sectorY + localRow, 0, map.height - 1),
    };
  } else if (cfg.patrolPattern === "perimeter") {
    // Walk the perimeter of the patrol radius
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
    // Spiral: expanding circle
    const spiralTick = tick + hashString(agent.id);
    const radius = (spiralTick % cfg.patrolRadius) + 1;
    const angle = (spiralTick * 0.5) % (2 * Math.PI);
    targetPos = {
      x: clamp(Math.round(base.x + Math.cos(angle) * radius), 0, map.width - 1),
      y: clamp(Math.round(base.y + Math.sin(angle) * radius), 0, map.height - 1),
    };
  }

  // Linger logic — stay if close to target and within linger period
  if (distance(agent.position, targetPos) <= 1 && tick % (cfg.lingerTicks + 1) !== 0) {
    return {
      agentId: agent.id,
      agentType: "scout",
      action: "observe",
      reason: `Observing area around (${agent.position.x}, ${agent.position.y})`,
      from: agent.position,
      to: null,
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
  };
}

function executeDefender(agent: Agent, doctrine: Doctrine, map: GameMap): AgentAction {
  const cfg = doctrine.defender;
  const base = doctrine.basePosition;
  const distFromBase = distance(agent.position, base);

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
    };
  }

  // Hold position (no threats in Milestone 1 — just demonstrate the posture)
  return {
    agentId: agent.id,
    agentType: "defender",
    action: "guard",
    reason: `Holding position within guard radius (${distFromBase}/${cfg.guardRadius})`,
    from: agent.position,
    to: null,
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
): AgentAction {
  switch (agent.type) {
    case "gatherer":
      return executeGatherer(agent, doctrine, map, knownResources);
    case "scout":
      return executeScout(agent, doctrine, map, tick, newKnownResources);
    case "defender":
      return executeDefender(agent, doctrine, map);
  }
}

/** Apply an action's effects to the mutable game state. */
export function applyAction(action: AgentAction, agents: Agent[], map: GameMap): number {
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
        }
      }
      break;
    }

    case "deposit":
      collected = agent.carrying;
      agent.carrying = 0;
      agent.status = "returning";
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

// --- Helpers ---

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
