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

// --- Memory ---

/** Persists task state across ticks (Tier 1: Working Memory) */
export interface WorkingMemory {
  /** Current task the agent is committed to */
  currentTask: string | null;
  /** Target position of the current task */
  taskTarget: Position | null;
  /** Tick when the current task was started */
  taskStartTick: number | null;
}

export type EpisodeEventType =
  | "resource-found"
  | "resource-depleted"
  | "task-completed"
  | "threat-spotted"
  | "damage-taken";

/** A single recorded observation (Tier 2: Episodic Memory) */
export interface EpisodeRecord {
  tick: number;
  eventType: EpisodeEventType;
  position: Position;
  detail: string;
}

/** Memory configuration per agent type */
export interface MemoryConfig {
  /** Maximum episodes to retain. 0 = unlimited (no trimming by count). */
  maxEpisodes: number;
  /** Episodes older than this many ticks are dropped. 0 = keep forever. */
  decayAfterTicks: number;
}

// --- Agents ---

export type AgentType = "gatherer" | "scout" | "defender";

export type AgentStatus = "idle" | "moving" | "gathering" | "depositing" | "scouting" | "defending" | "returning";

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
  /** Working memory: persists current task across ticks */
  workingMemory: WorkingMemory;
  /** Episodic memory: log of significant observed events */
  episodes: EpisodeRecord[];
  /** The doctrine version this agent is currently running */
  deployedDoctrineVersion: number;
}

// --- Threats ---

/** A hostile unit that wanders and damages agents */
export interface Threat {
  id: string;
  position: Position;
  hp: number;
  maxHp: number;
}

// --- Towers ---

/** A communication tower — doctrine updates broadcast to agents within range */
export interface Tower {
  id: string;
  position: Position;
  /** Radius in which doctrine propagates each tick */
  broadcastRadius: number;
}

// --- Doctrine ---

export interface GathererDoctrine {
  /** How close a resource must be to prioritize it */
  searchRadius: number;
  /** How many resources to carry before returning to base */
  returnThreshold: number;
  /** Whether to prefer closest resource or richest */
  preferClosest: boolean;
  /**
   * When true, gatherers consult scout-reported intel before their local scan.
   * Enables coordinated targeting but makes gatherers dependent on active scouts.
   * When false, local scan runs first; intel is only a fallback.
   */
  preferScoutIntel: boolean;
  memory: MemoryConfig;
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
  memory: MemoryConfig;
}

export interface DefenderDoctrine {
  /** Distance from base to hold position */
  guardRadius: number;
  /** Whether to chase threats or hold position */
  chaseThreats: boolean;
  /** Max chase distance before returning */
  maxChaseDistance: number;
  memory: MemoryConfig;
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
  /** Which doctrine version the agent used for this decision */
  doctrineVersion: number;
}

export interface TickDebrief {
  tick: number;
  timestamp: number;
  actions: AgentAction[];
  resourcesCollected: number;
  totalResources: number;
  /** Notices about redundant or suboptimal behavior detected this tick */
  notices: string[];
}

// --- Game State ---

export type GamePhase = "setup" | "running" | "paused";

export interface GameState {
  phase: GamePhase;
  tick: number;
  map: GameMap;
  agents: Agent[];
  doctrine: Doctrine;
  /** Most recent prior doctrine — exposed for UI display only. Agent version resolution uses doctrineHistory on the server. */
  previousDoctrine: Doctrine | null;
  basePosition: Position;
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
  /**
   * Resource positions discovered by scouts (when reportResourceFinds=true).
   * Gatherers fall back to this list when their local scan finds nothing.
   */
  knownResources: Position[];
  /** Hostile units roaming the map */
  threats: Threat[];
  /** Communication towers — doctrine propagates to agents within broadcast radius */
  towers: Tower[];
}

// --- Default Doctrine ---

export const DEFAULT_DOCTRINE: Doctrine = {
  version: 1,
  name: "Default Doctrine",
  gatherer: {
    searchRadius: 4,
    returnThreshold: 3,
    preferClosest: true,
    preferScoutIntel: true,
    memory: { maxEpisodes: 10, decayAfterTicks: 30 },
  },
  scout: {
    patrolRadius: 12,
    patrolPattern: "grid",
    lingerTicks: 2,
    reportResourceFinds: true,
    memory: { maxEpisodes: 20, decayAfterTicks: 50 },
  },
  defender: {
    guardRadius: 4,
    chaseThreats: true,
    maxChaseDistance: 6,
    memory: { maxEpisodes: 15, decayAfterTicks: 40 },
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
      required: ["searchRadius", "returnThreshold", "preferClosest", "preferScoutIntel", "memory"],
      properties: {
        searchRadius: { type: "number", minimum: 1, maximum: 32 },
        returnThreshold: { type: "number", minimum: 1, maximum: 10 },
        preferClosest: { type: "boolean" },
        preferScoutIntel: { type: "boolean" },
        memory: {
          type: "object",
          required: ["maxEpisodes", "decayAfterTicks"],
          properties: {
            maxEpisodes: { type: "number", minimum: 0, maximum: 100 },
            decayAfterTicks: { type: "number", minimum: 0, maximum: 500 },
          },
        },
      },
    },
    scout: {
      type: "object",
      required: ["patrolRadius", "patrolPattern", "lingerTicks", "reportResourceFinds", "memory"],
      properties: {
        patrolRadius: { type: "number", minimum: 1, maximum: 20 },
        patrolPattern: { type: "string", enum: ["grid", "spiral", "perimeter"] },
        lingerTicks: { type: "number", minimum: 0, maximum: 10 },
        reportResourceFinds: { type: "boolean" },
        memory: {
          type: "object",
          required: ["maxEpisodes", "decayAfterTicks"],
          properties: {
            maxEpisodes: { type: "number", minimum: 0, maximum: 100 },
            decayAfterTicks: { type: "number", minimum: 0, maximum: 500 },
          },
        },
      },
    },
    defender: {
      type: "object",
      required: ["guardRadius", "chaseThreats", "maxChaseDistance", "memory"],
      properties: {
        guardRadius: { type: "number", minimum: 1, maximum: 15 },
        chaseThreats: { type: "boolean" },
        maxChaseDistance: { type: "number", minimum: 1, maximum: 20 },
        memory: {
          type: "object",
          required: ["maxEpisodes", "decayAfterTicks"],
          properties: {
            maxEpisodes: { type: "number", minimum: 0, maximum: 100 },
            decayAfterTicks: { type: "number", minimum: 0, maximum: 500 },
          },
        },
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
