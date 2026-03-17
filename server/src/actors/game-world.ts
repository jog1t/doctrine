import { actor } from "rivetkit";
import type {
  Agent,
  AgentAction,
  AgentType,
  Doctrine,
  EpisodeRecord,
  GameMap,
  GamePhase,
  GameState,
  Position,
  TickDebrief,
  Threat,
  Tower,
} from "@doctrine/shared";
import { DEFAULT_DOCTRINE } from "@doctrine/shared";
import { generateMap } from "../engine/map-generator.js";
import {
  applyAction,
  applyMemoryUpdates,
  applyThreatDamage,
  executeAgent,
  moveThreat,
} from "../engine/agent-logic.js";

// --- Initial agent placement ---

function createAgent(id: string, type: AgentType, base: { x: number; y: number }, doctrineVersion: number): Agent {
  const offsets: Record<AgentType, { x: number; y: number }[]> = {
    gatherer: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ],
    scout: [
      { x: -2, y: -2 },
      { x: 2, y: 2 },
    ],
    defender: [
      { x: 0, y: 1 },
      { x: -1, y: 1 },
    ],
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
    workingMemory: { currentTask: null, taskTarget: null, taskStartTick: null },
    episodes: [],
    deployedDoctrineVersion: doctrineVersion,
  };
}

function createInitialAgents(base: { x: number; y: number }, doctrineVersion: number): Agent[] {
  return [
    createAgent("gatherer-0", "gatherer", base, doctrineVersion),
    createAgent("gatherer-1", "gatherer", base, doctrineVersion),
    createAgent("gatherer-2", "gatherer", base, doctrineVersion),
    createAgent("scout-0", "scout", base, doctrineVersion),
    createAgent("scout-1", "scout", base, doctrineVersion),
    createAgent("defender-0", "defender", base, doctrineVersion),
    createAgent("defender-1", "defender", base, doctrineVersion),
  ];
}

// --- Threat spawning ---

const THREAT_SPAWN_INTERVAL = 20; // ticks between threat spawns
const MAX_THREATS = 3;

function spawnThreat(id: string, map: GameMap): Threat {
  // Spawn at a random map edge (deterministic per id to avoid Math.random)
  const hash = hashId(id);
  const edge = hash % 4;
  let x: number;
  let y: number;
  switch (edge) {
    case 0:
      x = hash % map.width;
      y = 0;
      break;
    case 1:
      x = map.width - 1;
      y = hash % map.height;
      break;
    case 2:
      x = hash % map.width;
      y = map.height - 1;
      break;
    default:
      x = 0;
      y = hash % map.height;
      break;
  }
  return { id, position: { x, y }, hp: 3, maxHp: 3 };
}

function hashId(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// --- Tower construction ---

function createInitialTower(base: Position): Tower {
  return { id: "tower-0", position: { ...base }, broadcastRadius: 8 };
}

// --- Actor definition ---

export const gameWorld = actor({
  state: {
    phase: "setup" as GamePhase,
    tick: 0,
    map: null as GameMap | null,
    agents: [] as Agent[],
    doctrine: DEFAULT_DOCTRINE as Doctrine,
    /** Normalized history of past doctrine versions, keyed by version. Capped at 5 entries. */
    doctrineHistory: [] as Array<{ version: number; doctrine: Doctrine }>,
    basePosition: DEFAULT_DOCTRINE.basePosition,
    totalResourcesCollected: 0,
    debriefs: [] as TickDebrief[],
    seed: 0,
    tickIntervalMs: 1000,
    autoTick: false,
    knownResources: [] as Position[],
    threats: [] as Threat[],
    towers: [] as Tower[],
    nextThreatId: 0,
  },

  actions: {
    initGame: (c, seed?: number) => {
      const gameSeed = seed ?? Date.now();
      const map = generateMap(gameSeed);
      const base = c.state.doctrine.basePosition;
      const docVersion = c.state.doctrine.version;
      const agents = createInitialAgents(base, docVersion);

      c.state.phase = "setup";
      c.state.tick = 0;
      c.state.map = map;
      c.state.agents = agents;
      c.state.totalResourcesCollected = 0;
      c.state.debriefs = [];
      c.state.seed = gameSeed;
      c.state.autoTick = false;
      c.state.knownResources = [];
      c.state.threats = [];
      c.state.towers = [createInitialTower(base)];
      c.state.nextThreatId = 0;
      c.state.doctrineHistory = [];

      c.broadcast("gameInitialized", getPublicState(c.state));
      return getPublicState(c.state);
    },

    deployDoctrine: (c, doctrine: Doctrine) => {
      // Save normalized current doctrine to history before replacing it.
      // Normalization ensures persisted state missing new fields won't crash applyMemoryUpdates.
      c.state.doctrineHistory.push({
        version: c.state.doctrine.version,
        doctrine: normalizeDoctrine(c.state.doctrine),
      });
      // Trim history, but never evict a version still referenced by an agent —
      // agents on evicted versions would silently fall back to current doctrine.
      if (c.state.doctrineHistory.length > 5) {
        const referencedVersions = new Set(c.state.agents.map((a) => a.deployedDoctrineVersion));
        while (
          c.state.doctrineHistory.length > 5 &&
          !referencedVersions.has(c.state.doctrineHistory[0].version)
        ) {
          c.state.doctrineHistory.shift();
        }
      }

      const newVersion = (c.state.doctrine.version || 0) + 1;
      // Normalize incoming doctrine so missing fields don't crash server or client.
      c.state.doctrine = normalizeDoctrine({ ...doctrine, version: newVersion });
      c.state.basePosition = c.state.doctrine.basePosition;

      // Immediately update agents within any tower's broadcast radius
      for (const agent of c.state.agents) {
        for (const tower of c.state.towers) {
          if (euclideanDist(agent.position, tower.position) <= tower.broadcastRadius) {
            agent.deployedDoctrineVersion = newVersion;
            break;
          }
        }
      }

      c.broadcast("doctrineDeployed", {
        doctrine: c.state.doctrine,
        tick: c.state.tick,
      });
      return c.state.doctrine;
    },

    executeTick: (c) => {
      if (!c.state.map) {
        throw new Error("Game not initialized");
      }

      // Migrate persisted doctrine that may predate newer fields
      c.state.doctrine = normalizeDoctrine(c.state.doctrine);

      // Migrate persisted game state that may predate M2 fields
      c.state.threats ??= [];
      c.state.towers ??= [createInitialTower(c.state.basePosition)];
      c.state.doctrineHistory ??= [];
      c.state.nextThreatId ??= 0;
      for (const agent of c.state.agents) {
        agent.workingMemory ??= { currentTask: null, taskTarget: null, taskStartTick: null };
        agent.episodes ??= [];
        agent.deployedDoctrineVersion ??= c.state.doctrine.version;
      }

      c.state.tick += 1;
      c.state.phase = "running";

      // Spawn new threat periodically
      if (
        c.state.tick % THREAT_SPAWN_INTERVAL === 0 &&
        c.state.threats.length < MAX_THREATS
      ) {
        const threatId = `threat-${c.state.nextThreatId++}`;
        c.state.threats.push(spawnThreat(threatId, c.state.map));
      }

      const { debrief, newKnownResources, killedAgentIds } = runTick(
        c.state.tick,
        c.state.agents,
        c.state.doctrine,
        c.state.doctrineHistory,
        c.state.map,
        c.state.knownResources,
        c.state.threats,
      );

      // Merge scout discoveries
      for (const pos of newKnownResources) {
        const already = c.state.knownResources.some((k) => k.x === pos.x && k.y === pos.y);
        if (!already) c.state.knownResources.push(pos);
      }

      // Remove depleted tiles from known list
      c.state.knownResources = c.state.knownResources.filter((pos) => {
        const tile = c.state.map!.tiles[pos.y][pos.x];
        return tile.type === "resource" && tile.resources > 0;
      });

      // Hard death: remove killed agents (episodic memory is gone with them)
      if (killedAgentIds.length > 0) {
        const killedSet = new Set(killedAgentIds);
        c.state.agents = c.state.agents.filter((a) => !killedSet.has(a.id));
        debrief.notices.push(
          ...killedAgentIds.map((id) => `FALLEN: ${id} was destroyed — all episodic memory lost`),
        );
      }

      c.state.totalResourcesCollected += debrief.resourcesCollected;
      debrief.totalResources = c.state.totalResourcesCollected;

      // Tower broadcast: each tick update agents within tower range to current doctrine
      const currentVersion = c.state.doctrine.version;
      for (const agent of c.state.agents) {
        if (agent.deployedDoctrineVersion < currentVersion) {
          for (const tower of c.state.towers) {
            if (euclideanDist(agent.position, tower.position) <= tower.broadcastRadius) {
              agent.deployedDoctrineVersion = currentVersion;
              debrief.notices.push(
                `SYNC: ${agent.id} received doctrine v${currentVersion} from tower at (${tower.position.x}, ${tower.position.y})`,
              );
              break;
            }
          }
        }
      }

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

    startAutoTick: (c) => {
      if (!c.state.map) throw new Error("Game not initialized");
      c.state.autoTick = true;
      c.state.phase = "running";
      c.broadcast("autoTickChanged", { autoTick: true });
      return { autoTick: true };
    },

    stopAutoTick: (c) => {
      c.state.autoTick = false;
      c.state.phase = "paused";
      c.broadcast("autoTickChanged", { autoTick: false });
      return { autoTick: false };
    },

    getState: (c) => {
      return getPublicState(c.state);
    },

    getDebriefs: (c, count?: number) => {
      const n = count ?? 10;
      return c.state.debriefs.slice(-n);
    },

    setTickInterval: (c, ms: number) => {
      c.state.tickIntervalMs = Math.max(100, Math.min(5000, ms));
      c.broadcast("tickIntervalChanged", { tickIntervalMs: c.state.tickIntervalMs });
      return { tickIntervalMs: c.state.tickIntervalMs };
    },
  },
});

// --- Tick execution ---

function detectRedundancyNotices(actions: AgentAction[]): string[] {
  const notices: string[] = [];
  const moveActions = actions.filter(
    (a) => a.to && (a.action === "move" || a.action === "move-intel"),
  );

  const byTarget = new Map<string, AgentAction[]>();
  for (const action of moveActions) {
    const key = `${action.to!.x},${action.to!.y}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key)!.push(action);
  }

  for (const [pos, acts] of byTarget) {
    if (acts.length > 1) {
      const ids = acts.map((a) => a.agentId).join(", ");
      notices.push(`REDUNDANT: ${ids} all moving to (${pos}) — consider spreading agents`);
    }
  }

  return notices;
}

function runTick(
  tick: number,
  agents: Agent[],
  doctrine: Doctrine,
  doctrineHistory: Array<{ version: number; doctrine: Doctrine }>,
  map: GameMap,
  knownResources: Position[],
  threats: Threat[],
): {
  debrief: TickDebrief;
  newKnownResources: Position[];
  killedAgentIds: string[];
} {
  const newKnownResources: Position[] = [];
  const pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }> = [];

  // Execute agent decisions (each uses the doctrine version they were last updated to)
  const actions = agents.map((agent) => {
    const agentDoctrine = resolveDoctrineForAgent(agent, doctrine, doctrineHistory);
    return executeAgent(agent, agentDoctrine, map, tick, knownResources, newKnownResources, threats, pendingEpisodes);
  });

  // Apply actions
  let resourcesCollected = 0;
  for (const action of actions) {
    resourcesCollected += applyAction(action, agents, map, tick, pendingEpisodes);
  }

  // Move threats toward agents
  for (const threat of threats) {
    moveThreat(threat, agents, map);
  }

  // Deal damage from threats
  const killedAgentIds = applyThreatDamage(threats, agents, tick, pendingEpisodes);

  // Apply episodic memory updates and decay
  applyMemoryUpdates(agents, doctrine, pendingEpisodes, tick, doctrineHistory);

  const notices = detectRedundancyNotices(actions);

  return {
    debrief: {
      tick,
      timestamp: Date.now(),
      actions,
      resourcesCollected,
      totalResources: 0,
      notices,
    },
    newKnownResources,
    killedAgentIds,
  };
}

// --- Helpers ---

/** Returns the doctrine version the agent was last updated to, falling back to current. */
function resolveDoctrineForAgent(
  agent: Agent,
  current: Doctrine,
  history: Array<{ version: number; doctrine: Doctrine }>,
): Doctrine {
  if (agent.deployedDoctrineVersion === current.version) return current;
  return history.find((h) => h.version === agent.deployedDoctrineVersion)?.doctrine ?? current;
}

function euclideanDist(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Fill in any missing fields from DEFAULT_DOCTRINE so old persisted state doesn't crash. */
function normalizeDoctrine(doctrine: Doctrine): Doctrine {
  return {
    ...DEFAULT_DOCTRINE,
    ...doctrine,
    gatherer: {
      ...DEFAULT_DOCTRINE.gatherer,
      ...doctrine.gatherer,
      memory: { ...DEFAULT_DOCTRINE.gatherer.memory, ...doctrine.gatherer?.memory },
    },
    scout: {
      ...DEFAULT_DOCTRINE.scout,
      ...doctrine.scout,
      memory: { ...DEFAULT_DOCTRINE.scout.memory, ...doctrine.scout?.memory },
    },
    defender: {
      ...DEFAULT_DOCTRINE.defender,
      ...doctrine.defender,
      memory: { ...DEFAULT_DOCTRINE.defender.memory, ...doctrine.defender?.memory },
    },
  };
}

function getPublicState(state: {
  phase: GamePhase;
  tick: number;
  map: GameMap | null;
  agents: Agent[];
  doctrine: Doctrine;
  doctrineHistory: Array<{ version: number; doctrine: Doctrine }>;
  basePosition: { x: number; y: number };
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
  knownResources: Position[];
  threats: Threat[];
  towers: Tower[];
}): GameState {
  // Expose the most-recent historical doctrine as previousDoctrine for the client UI
  const previousDoctrine = (state.doctrineHistory ?? []).at(-1)?.doctrine ?? null;
  return {
    phase: state.phase,
    tick: state.tick,
    map: state.map!,
    agents: state.agents,
    doctrine: normalizeDoctrine(state.doctrine),
    previousDoctrine,
    basePosition: state.basePosition,
    totalResourcesCollected: state.totalResourcesCollected,
    debriefs: state.debriefs,
    knownResources: state.knownResources,
    threats: state.threats,
    towers: state.towers,
  };
}
