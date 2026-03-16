// ============================================================
// Doctrine — Shared Types
// All types shared between server (RivetKit actors) and client (React)
// ============================================================

// --- Map & World ---

export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 24;

export type TileType = "empty" | "resource" | "obstacle";

export interface Tile {
  type: TileType;
  /** Resource amount remaining (only for type=resource) */
  resources: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[][];
}

// --- Agents ---

export type AgentType = "gatherer" | "scout" | "defender";

export type AgentStatus = "idle" | "moving" | "gathering" | "scouting" | "defending" | "returning";

export interface Agent {
  id: string;
  type: AgentType;
  position: Position;
  status: AgentStatus;
  /** Resources currently carried (gatherers only) */
  carrying: number;
  /** Maximum carry capacity */
  carryCapacity: number;
  /** Health points */
  hp: number;
  maxHp: number;
  /** Current target position, if any */
  target: Position | null;
  /** Vision radius in tiles */
  visionRadius: number;
}

// --- Doctrine ---

export interface GathererDoctrine {
  /** How close a resource must be to prioritize it */
  searchRadius: number;
  /** How many resources to carry before returning to base */
  returnThreshold: number;
  /** Whether to prefer closest resource or richest */
  preferClosest: boolean;
}

export interface ScoutDoctrine {
  /** How far from base to patrol */
  patrolRadius: number;
  /**
   * How scouts choose where to move:
   * - "grid"      — map divided into sectors; each scout owns one and sweeps it
   * - "perimeter" — walk the outer edge of the patrol radius
   * - "spiral"    — expanding outward circle
   */
  patrolPattern: "grid" | "spiral" | "perimeter";
  /** How many ticks to stay at a position before moving */
  lingerTicks: number;
  /**
   * When true, scouts broadcast observed resource positions to a shared list
   * that gatherers can query when their local searchRadius finds nothing.
   */
  reportResourceFinds: boolean;
}

export interface DefenderDoctrine {
  /** Distance from base to hold position */
  guardRadius: number;
  /** Whether to chase threats or hold position */
  chaseThreats: boolean;
  /** Max chase distance before returning */
  maxChaseDistance: number;
}

export interface Doctrine {
  version: number;
  name: string;
  gatherer: GathererDoctrine;
  scout: ScoutDoctrine;
  defender: DefenderDoctrine;
  /** Base position — where gatherers return resources */
  basePosition: Position;
}

// --- Tick & Debrief ---

export interface AgentAction {
  agentId: string;
  agentType: AgentType;
  action: string;
  reason: string;
  from: Position;
  to: Position | null;
}

export interface TickDebrief {
  tick: number;
  timestamp: number;
  actions: AgentAction[];
  resourcesCollected: number;
  totalResources: number;
}

// --- Game State ---

export type GamePhase = "setup" | "running" | "paused";

export interface GameState {
  phase: GamePhase;
  tick: number;
  map: GameMap;
  agents: Agent[];
  doctrine: Doctrine;
  basePosition: Position;
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
  /**
   * Resource positions discovered by scouts (when reportResourceFinds=true).
   * Gatherers fall back to this list when their local scan finds nothing.
   */
  knownResources: Position[];
}

// --- Default Doctrine ---

export const DEFAULT_DOCTRINE: Doctrine = {
  version: 1,
  name: "Default Doctrine",
  gatherer: {
    searchRadius: 10,
    returnThreshold: 3,
    preferClosest: true,
  },
  scout: {
    patrolRadius: 12,
    patrolPattern: "grid",
    lingerTicks: 2,
    reportResourceFinds: true,
  },
  defender: {
    guardRadius: 4,
    chaseThreats: false,
    maxChaseDistance: 6,
  },
  basePosition: { x: 16, y: 12 },
};

// --- JSON Schema for doctrine validation ---

export const DOCTRINE_SCHEMA = {
  type: "object",
  required: ["version", "name", "gatherer", "scout", "defender", "basePosition"],
  properties: {
    version: { type: "number", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 64 },
    gatherer: {
      type: "object",
      required: ["searchRadius", "returnThreshold", "preferClosest"],
      properties: {
        searchRadius: { type: "number", minimum: 1, maximum: 20 },
        returnThreshold: { type: "number", minimum: 1, maximum: 10 },
        preferClosest: { type: "boolean" },
      },
    },
    scout: {
      type: "object",
      required: ["patrolRadius", "patrolPattern", "lingerTicks", "reportResourceFinds"],
      properties: {
        patrolRadius: { type: "number", minimum: 1, maximum: 20 },
        patrolPattern: { type: "string", enum: ["grid", "spiral", "perimeter"] },
        lingerTicks: { type: "number", minimum: 0, maximum: 10 },
        reportResourceFinds: { type: "boolean" },
      },
    },
    defender: {
      type: "object",
      required: ["guardRadius", "chaseThreats", "maxChaseDistance"],
      properties: {
        guardRadius: { type: "number", minimum: 1, maximum: 15 },
        chaseThreats: { type: "boolean" },
        maxChaseDistance: { type: "number", minimum: 1, maximum: 20 },
      },
    },
    basePosition: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "number", minimum: 0 },
        y: { type: "number", minimum: 0 },
      },
    },
  },
} as const;
