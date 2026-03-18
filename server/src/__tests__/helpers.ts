import type { Agent, AgentType, Doctrine, GameMap, Threat, Tower } from "@doctrine/shared";
import { DEFAULT_DOCTRINE } from "@doctrine/shared";

export function makeMap(width = 32, height = 24): GameMap {
  return {
    width,
    height,
    tiles: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ type: "empty" as const, resources: 0 })),
    ),
  };
}

export function makeAgent(
  id: string,
  type: AgentType,
  pos: { x: number; y: number },
  overrides: Partial<Agent> = {},
): Agent {
  return {
    id,
    type,
    position: pos,
    status: "idle",
    carrying: 0,
    carryCapacity: type === "gatherer" ? 5 : 0,
    hp: type === "defender" ? 10 : 5,
    maxHp: type === "defender" ? 10 : 5,
    target: null,
    visionRadius: type === "scout" ? 6 : 3,
    workingMemory: { currentTask: null, taskTarget: null, taskStartTick: null },
    episodes: [],
    deployedDoctrineVersion: DEFAULT_DOCTRINE.version,
    ...overrides,
  };
}

export function makeThreat(id: string, pos: { x: number; y: number }): Threat {
  return { id, position: pos, hp: 3, maxHp: 3 };
}

export function makeTower(id: string, pos: { x: number; y: number }, radius = 8): Tower {
  return { id, position: pos, broadcastRadius: radius };
}

export function makeDoctrine(overrides: Partial<Doctrine> = {}): Doctrine {
  return { ...DEFAULT_DOCTRINE, ...overrides };
}

/** Place a resource tile at (x, y) with given amount */
export function placeResource(map: GameMap, x: number, y: number, amount = 5): void {
  map.tiles[y][x] = { type: "resource", resources: amount };
}

/** Place an obstacle at (x, y) */
export function placeObstacle(map: GameMap, x: number, y: number): void {
  map.tiles[y][x] = { type: "obstacle", resources: 0 };
}
