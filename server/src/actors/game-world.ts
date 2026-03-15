import { actor } from "rivetkit";
import type {
  Agent,
  AgentType,
  Doctrine,
  GameMap,
  GamePhase,
  GameState,
  TickDebrief,
} from "@doctrine/shared";
import { DEFAULT_DOCTRINE } from "@doctrine/shared";
import { generateMap } from "../engine/map-generator.js";
import { executeAgent, applyAction } from "../engine/agent-logic.js";

// --- Initial agent placement ---

function createAgent(id: string, type: AgentType, base: { x: number; y: number }): Agent {
  // Spread agents around the base
  const offsets: Record<AgentType, { x: number; y: number }[]> = {
    gatherer: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }],
    scout: [{ x: -2, y: -2 }, { x: 2, y: 2 }],
    defender: [{ x: 0, y: 1 }, { x: -1, y: 1 }],
  };

  const typeOffsets = offsets[type];
  const idx = parseInt(id.split("-")[1] || "0") % typeOffsets.length;
  const offset = typeOffsets[idx];

  return {
    id,
    type,
    position: { x: base.x + offset.x, y: base.y + offset.y },
    status: "idle",
    carrying: 0,
    carryCapacity: type === "gatherer" ? 5 : 0,
    hp: type === "defender" ? 10 : 5,
    maxHp: type === "defender" ? 10 : 5,
    target: null,
    visionRadius: type === "scout" ? 6 : 3,
  };
}

function createInitialAgents(base: { x: number; y: number }): Agent[] {
  return [
    createAgent("gatherer-0", "gatherer", base),
    createAgent("gatherer-1", "gatherer", base),
    createAgent("gatherer-2", "gatherer", base),
    createAgent("scout-0", "scout", base),
    createAgent("scout-1", "scout", base),
    createAgent("defender-0", "defender", base),
    createAgent("defender-1", "defender", base),
  ];
}

// --- Actor definition ---

export const gameWorld = actor({
  state: {
    phase: "setup" as GamePhase,
    tick: 0,
    map: null as GameMap | null,
    agents: [] as Agent[],
    doctrine: DEFAULT_DOCTRINE as Doctrine,
    basePosition: DEFAULT_DOCTRINE.basePosition,
    totalResourcesCollected: 0,
    /** Keep last N debriefs for review */
    debriefs: [] as TickDebrief[],
    /** Map seed for reproducibility */
    seed: 0,
    /** Tick interval in ms (configurable) */
    tickIntervalMs: 1000,
    /** Whether auto-tick is running */
    autoTick: false,
  },

  actions: {
    /** Initialize a new game session */
    initGame: (c, seed?: number) => {
      const gameSeed = seed ?? Date.now();
      const map = generateMap(gameSeed);
      const base = c.state.doctrine.basePosition;
      const agents = createInitialAgents(base);

      c.state.phase = "setup";
      c.state.tick = 0;
      c.state.map = map;
      c.state.agents = agents;
      c.state.totalResourcesCollected = 0;
      c.state.debriefs = [];
      c.state.seed = gameSeed;
      c.state.autoTick = false;

      c.broadcast("gameInitialized", getPublicState(c.state));
      return getPublicState(c.state);
    },

    /** Deploy new doctrine configuration */
    deployDoctrine: (c, doctrine: Doctrine) => {
      c.state.doctrine = { ...doctrine, version: (c.state.doctrine.version || 0) + 1 };
      c.state.basePosition = doctrine.basePosition;

      c.broadcast("doctrineDeployed", {
        doctrine: c.state.doctrine,
        tick: c.state.tick,
      });
      return c.state.doctrine;
    },

    /** Execute a single game tick */
    executeTick: (c) => {
      if (!c.state.map) {
        throw new Error("Game not initialized");
      }

      c.state.tick += 1;
      c.state.phase = "running";

      const debrief = runTick(
        c.state.tick,
        c.state.agents,
        c.state.doctrine,
        c.state.map
      );

      c.state.totalResourcesCollected += debrief.resourcesCollected;
      debrief.totalResources = c.state.totalResourcesCollected;

      // Keep last 50 debriefs
      c.state.debriefs.push(debrief);
      if (c.state.debriefs.length > 50) {
        c.state.debriefs = c.state.debriefs.slice(-50);
      }

      c.broadcast("tickCompleted", {
        state: getPublicState(c.state),
        debrief,
      });

      return { state: getPublicState(c.state), debrief };
    },

    /** Start automatic tick execution */
    startAutoTick: (c) => {
      if (!c.state.map) throw new Error("Game not initialized");
      c.state.autoTick = true;
      c.state.phase = "running";
      c.broadcast("autoTickChanged", { autoTick: true });
      return { autoTick: true };
    },

    /** Stop automatic tick execution */
    stopAutoTick: (c) => {
      c.state.autoTick = false;
      c.state.phase = "paused";
      c.broadcast("autoTickChanged", { autoTick: false });
      return { autoTick: false };
    },

    /** Get current game state */
    getState: (c) => {
      return getPublicState(c.state);
    },

    /** Get recent debriefs */
    getDebriefs: (c, count?: number) => {
      const n = count ?? 10;
      return c.state.debriefs.slice(-n);
    },

    /** Set tick speed */
    setTickInterval: (c, ms: number) => {
      c.state.tickIntervalMs = Math.max(100, Math.min(5000, ms));
      c.broadcast("tickIntervalChanged", { tickIntervalMs: c.state.tickIntervalMs });
      return { tickIntervalMs: c.state.tickIntervalMs };
    },
  },
});

// --- Tick execution ---

function runTick(
  tick: number,
  agents: Agent[],
  doctrine: Doctrine,
  map: GameMap
): TickDebrief {
  const actions = agents.map((agent) =>
    executeAgent(agent, doctrine, map, tick)
  );

  let resourcesCollected = 0;
  for (const action of actions) {
    resourcesCollected += applyAction(action, agents, map);
  }

  return {
    tick,
    timestamp: Date.now(),
    actions,
    resourcesCollected,
    totalResources: 0, // filled in by caller
  };
}

// --- Helpers ---

function getPublicState(state: {
  phase: GamePhase;
  tick: number;
  map: GameMap | null;
  agents: Agent[];
  doctrine: Doctrine;
  basePosition: { x: number; y: number };
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
}): GameState {
  return {
    phase: state.phase,
    tick: state.tick,
    map: state.map!,
    agents: state.agents,
    doctrine: state.doctrine,
    basePosition: state.basePosition,
    totalResourcesCollected: state.totalResourcesCollected,
    debriefs: state.debriefs,
  };
}
