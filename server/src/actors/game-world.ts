import { actor } from "rivetkit";
import type {
  Agent,
  AgentAction,
  AgentType,
  Doctrine,
  DoctrineHistoryEntry,
  DoctrineRenderSummary,
  EpisodeRecord,
  GameMap,
  GamePhase,
  GameState,
  Position,
  TickDebrief,
  Threat,
  ThreatSighting,
  Tower,
} from "@doctrine/shared";
import { DEFAULT_DOCTRINE, summarizeDoctrineForRender } from "@doctrine/shared";
import { generateMap } from "../engine/map-generator.js";
import {
  THREAT_SIGHTING_EXPIRY_TICKS,
  advanceEvictedAgentVersions,
  applyAction,
  applyMemoryUpdates,
  applyThreatDamage,
  executeAgent,
  moveThreat,
  spawnThreat,
} from "../engine/agent-logic.js";

// --- Initial agent placement ---

/** Snap a desired spawn position to the nearest passable tile using a spiral scan. */
function nearestPassable(desired: Position, map: GameMap): Position {
  const tile = map.tiles[desired.y]?.[desired.x];
  if (tile && tile.type !== "obstacle") return desired;

  for (let r = 1; r < Math.max(map.width, map.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only shell
        const x = desired.x + dx;
        const y = desired.y + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (map.tiles[y][x].type !== "obstacle") return { x, y };
      }
    }
  }
  return desired; // pathological all-obstacle map
}

function createAgent(id: string, type: AgentType, base: { x: number; y: number }, doctrineVersion: number, map: GameMap): Agent {
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
  const desired = { x: base.x + offset.x, y: base.y + offset.y };
  const position = nearestPassable(desired, map);

  return {
    id,
    type,
    position,
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

function createInitialAgents(base: { x: number; y: number }, doctrineVersion: number, map: GameMap): Agent[] {
  return [
    createAgent("gatherer-0", "gatherer", base, doctrineVersion, map),
    createAgent("gatherer-1", "gatherer", base, doctrineVersion, map),
    createAgent("gatherer-2", "gatherer", base, doctrineVersion, map),
    createAgent("scout-0", "scout", base, doctrineVersion, map),
    createAgent("scout-1", "scout", base, doctrineVersion, map),
    createAgent("defender-0", "defender", base, doctrineVersion, map),
    createAgent("defender-1", "defender", base, doctrineVersion, map),
  ];
}

// --- Threat spawning ---

const THREAT_SPAWN_INTERVAL = 20; // ticks between threat spawns
const MAX_THREATS = 3;
// --- Tower construction ---

function createInitialTower(base: Position): Tower {
  return { id: "tower-0", position: { ...base }, broadcastRadius: 8 };
}

type MutableWorldState = {
  doctrine: Doctrine;
  basePosition: Position;
  towers?: Tower[];
};

export type GameWorldRuntimeState = {
  phase: GamePhase;
  tick: number;
  map: GameMap | null;
  agents: Agent[];
  doctrine: Doctrine;
  doctrineHistory: DoctrineHistoryEntry[];
  basePosition: Position;
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
  seed: number;
  tickIntervalMs: number;
  autoTick: boolean;
  knownResources: Position[];
  threats: Threat[];
  threatSightings: ThreatSighting[];
  towers: Tower[];
  nextThreatId: number;
  autoTickGeneration: number;
};

export function normalizeAutoTickGeneration(
  state: Pick<GameWorldRuntimeState, "autoTickGeneration">,
): void {
  if (!Number.isFinite(state.autoTickGeneration)) {
    state.autoTickGeneration = 0;
  }
}

function scheduleNextAutoTick(
  c: {
    state: Pick<
      GameWorldRuntimeState,
      "autoTick" | "tickIntervalMs" | "autoTickGeneration"
    >;
    schedule: { after: (duration: number, actionName: string, ...args: unknown[]) => void };
  },
): void {
  if (!c.state.autoTick) return;
  normalizeAutoTickGeneration(c.state);
  c.schedule.after(c.state.tickIntervalMs, "runScheduledTick", c.state.autoTickGeneration);
}

export function advanceAutoTickGeneration(
  state: Pick<GameWorldRuntimeState, "autoTickGeneration">,
): number {
  normalizeAutoTickGeneration(state);
  state.autoTickGeneration += 1;
  return state.autoTickGeneration;
}

export function syncCanonicalBaseState(state: MutableWorldState): void {
  const canonicalBase = state.doctrine.basePosition;
  state.basePosition = { ...canonicalBase };

  state.towers ??= [];

  const baseTower = state.towers.find((tower) => tower.id === "tower-0");
  if (baseTower) {
    baseTower.position = { ...canonicalBase };
  } else {
    state.towers.push(createInitialTower(canonicalBase));
  }
}

export function upsertThreatSighting(
  sightings: ThreatSighting[],
  sighting: ThreatSighting,
): ThreatSighting[] {
  const nextSightings = [...sightings];
  const existingIndex = nextSightings.findIndex((entry) => entry.threatId === sighting.threatId);

  if (existingIndex === -1) {
    nextSightings.push(sighting);
    return nextSightings;
  }

  if (sighting.lastSeenTick >= nextSightings[existingIndex].lastSeenTick) {
    nextSightings[existingIndex] = sighting;
  }

  return nextSightings;
}

export function cleanupThreatSightings(
  sightings: ThreatSighting[],
  threats: Threat[],
  tick: number,
): ThreatSighting[] {
  const activeThreatIds = new Set(threats.map((threat) => threat.id));

  return sightings.filter((sighting) => {
    if (!activeThreatIds.has(sighting.threatId)) return false;
    return tick - sighting.lastSeenTick <= THREAT_SIGHTING_EXPIRY_TICKS;
  });
}

export function cleanupWorldIntel(state: {
  map: GameMap;
  knownResources: Position[];
  threats: Threat[];
  threatSightings: ThreatSighting[];
  tick: number;
}): {
  knownResources: Position[];
  threatSightings: ThreatSighting[];
} {
  const knownResources = state.knownResources.filter((pos) => {
    const tile = state.map.tiles[pos.y][pos.x];
    return tile.type === "resource" && tile.resources > 0;
  });

  const threatSightings = cleanupThreatSightings(
    state.threatSightings,
    state.threats,
    state.tick,
  );

  return { knownResources, threatSightings };
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
    doctrineHistory: [] as DoctrineHistoryEntry[],
    basePosition: DEFAULT_DOCTRINE.basePosition,
    totalResourcesCollected: 0,
    debriefs: [] as TickDebrief[],
    seed: 0,
    tickIntervalMs: 1000,
    autoTick: false,
    knownResources: [] as Position[],
    threats: [] as Threat[],
    threatSightings: [] as ThreatSighting[],
    towers: [] as Tower[],
    nextThreatId: 0,
    autoTickGeneration: 0,
  },

  actions: {
    initGame: (c, seed?: number) => {
      const gameSeed = seed ?? Date.now();
      const map = generateMap(gameSeed);
      const base = c.state.doctrine.basePosition;
      const docVersion = c.state.doctrine.version;
      const agents = createInitialAgents(base, docVersion, map);

      c.state.phase = "setup";
      c.state.tick = 0;
      c.state.map = map;
      c.state.agents = agents;
      c.state.totalResourcesCollected = 0;
      c.state.debriefs = [];
      c.state.seed = gameSeed;
      c.state.autoTick = false;
      advanceAutoTickGeneration(c.state);
      c.state.knownResources = [];
      c.state.threats = [];
      c.state.threatSightings = [];
      c.state.towers = [createInitialTower(base)];
      c.state.nextThreatId = 0;
      c.state.doctrineHistory = [];
      syncCanonicalBaseState(c.state);

      c.broadcast("gameInitialized", getPublicState(c.state));
      return getPublicState(c.state);
    },

    deployDoctrine: (c, doctrine: Doctrine) => {
      if (!c.state.map) {
        throw new Error("Game not initialized — call initGame before deployDoctrine");
      }

      // Migrate persisted state that may predate M2 fields — identical to executeTick,
      // but needed here because deployDoctrine can be called before any tick runs.
      c.state.doctrineHistory ??= [];
      c.state.towers ??= [createInitialTower(c.state.basePosition)];
      c.state.nextThreatId ??= 0;
      c.state.threatSightings ??= [];
      for (const agent of c.state.agents) {
        agent.workingMemory ??= { currentTask: null, taskTarget: null, taskStartTick: null };
        agent.episodes ??= [];
        agent.deployedDoctrineVersion ??= c.state.doctrine.version;
      }

      // Save normalized current doctrine to history before replacing it.
      // Normalization ensures persisted state missing new fields won't crash applyMemoryUpdates.
      c.state.doctrineHistory.push({
        version: c.state.doctrine.version,
        doctrine: normalizeDoctrine(c.state.doctrine),
      });
      // Hard-cap at 5 entries. Prioritize referenced versions (agents still running them);
      // fill remaining slots with newest unreferenced entries. If referenced entries alone
      // exceed 5, drop oldest referenced ones too (agents fall back to current doctrine).
      if (c.state.doctrineHistory.length > 5) {
        const referencedVersions = new Set(c.state.agents.map((a) => a.deployedDoctrineVersion));
        const referenced = c.state.doctrineHistory.filter((h) => referencedVersions.has(h.version));
        const unreferenced = c.state.doctrineHistory.filter((h) => !referencedVersions.has(h.version));
        const slotsForUnreferenced = Math.max(0, 5 - referenced.length);
        // slice(-0) === slice(0) returns the whole array — guard explicitly
        const keptUnreferenced = slotsForUnreferenced > 0 ? unreferenced.slice(-slotsForUnreferenced) : [];
        const trimmed = [...keptUnreferenced, ...referenced];
        trimmed.sort((a, b) => a.version - b.version);
        c.state.doctrineHistory = trimmed.slice(-5);
      }

      const newVersion = (c.state.doctrine.version || 0) + 1;
      // Normalize incoming doctrine so missing fields don't crash server or client.
      c.state.doctrine = normalizeDoctrine({ ...doctrine, version: newVersion });
      syncCanonicalBaseState(c.state);

      // Force-advance any agent whose version was just evicted from the history cap.
      // Prevents the silent mismatch where the agent appears stale but executes current config.
      advanceEvictedAgentVersions(c.state.agents, newVersion, c.state.doctrineHistory);

      // Immediately update agents within any tower's broadcast radius
      for (const agent of c.state.agents) {
        for (const tower of c.state.towers) {
          if (euclideanDist(agent.position, tower.position) <= tower.broadcastRadius) {
            agent.deployedDoctrineVersion = newVersion;
            break;
          }
        }
      }

      // Broadcast full public state so clients immediately see compact doctrine history,
      // updated agent deployedDoctrineVersions, and the new doctrine together.
      c.broadcast("doctrineDeployed", getPublicState(c.state));
      return c.state.doctrine;
    },

    executeTick: (c) => {
      return executeWorldTick(c);
    },

    runScheduledTick: (c, generation: number) => {
      normalizeAutoTickGeneration(c.state);

      if (!c.state.autoTick) {
        return { skipped: true, reason: "auto-tick-disabled" };
      }

      if (generation !== c.state.autoTickGeneration) {
        return { skipped: true, reason: "stale-generation" };
      }

      const result = executeWorldTick(c);

      if (c.state.autoTick && generation === c.state.autoTickGeneration) {
        scheduleNextAutoTick(c);
      }

      return result;
    },

    startAutoTick: (c) => {
      if (!c.state.map) {
        throw new Error("Game not initialized");
      }
      normalizeAutoTickGeneration(c.state);
      c.state.autoTick = true;
      c.state.phase = "running";
      advanceAutoTickGeneration(c.state);
      scheduleNextAutoTick(c);
      c.broadcast("autoTickChanged", { autoTick: true });
      return { autoTick: true };
    },

    stopAutoTick: (c) => {
      normalizeAutoTickGeneration(c.state);
      c.state.autoTick = false;
      c.state.phase = "paused";
      advanceAutoTickGeneration(c.state);
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
      normalizeAutoTickGeneration(c.state);
      c.state.tickIntervalMs = Math.max(100, Math.min(5000, ms));
      if (c.state.autoTick) {
        advanceAutoTickGeneration(c.state);
        scheduleNextAutoTick(c);
      }
      c.broadcast("tickIntervalChanged", { tickIntervalMs: c.state.tickIntervalMs });
      return { tickIntervalMs: c.state.tickIntervalMs };
    },
  },
});

function executeWorldTick(c: {
  state: GameWorldRuntimeState;
  broadcast: (name: string, payload: unknown) => void;
}): { state: GameState; debrief: TickDebrief } {
  if (!c.state.map) {
    throw new Error("Game not initialized");
  }

  c.state.doctrine = normalizeDoctrine(c.state.doctrine);
  syncCanonicalBaseState(c.state);

  c.state.threats ??= [];
  c.state.towers ??= [createInitialTower(c.state.basePosition)];
  c.state.doctrineHistory ??= [];
  c.state.nextThreatId ??= 0;
  c.state.threatSightings ??= [];
  for (const agent of c.state.agents) {
    agent.workingMemory ??= { currentTask: null, taskTarget: null, taskStartTick: null };
    agent.episodes ??= [];
    agent.deployedDoctrineVersion ??= c.state.doctrine.version;
  }
  advanceEvictedAgentVersions(c.state.agents, c.state.doctrine.version, c.state.doctrineHistory);
  for (const debrief of c.state.debriefs) {
    debrief.notices ??= [];
    for (const action of debrief.actions) {
      action.doctrineVersion ??= c.state.doctrine.version;
    }
  }

  c.state.tick += 1;
  c.state.phase = "running";

  if (
    c.state.tick % THREAT_SPAWN_INTERVAL === 0 &&
    c.state.threats.length < MAX_THREATS
  ) {
    const threatId = `threat-${c.state.nextThreatId++}`;
    c.state.threats.push(spawnThreat(threatId, c.state.map, c.state.seed));
  }

  const { debrief, newKnownResources, newThreatSightings, killedAgentIds, neutralizedThreatIds } = runTick(
    c.state.tick,
    c.state.agents,
    c.state.doctrine,
    c.state.doctrineHistory,
    c.state.map,
    c.state.knownResources,
    c.state.threatSightings,
    c.state.threats,
  );

  for (const pos of newKnownResources) {
    const already = c.state.knownResources.some((k) => k.x === pos.x && k.y === pos.y);
    if (!already) c.state.knownResources.push(pos);
  }

  for (const sighting of newThreatSightings) {
    c.state.threatSightings = upsertThreatSighting(c.state.threatSightings, sighting);
  }
  const cleanedIntel = cleanupWorldIntel({
    map: c.state.map,
    knownResources: c.state.knownResources,
    threats: c.state.threats,
    threatSightings: c.state.threatSightings,
    tick: c.state.tick,
  });
  c.state.knownResources = cleanedIntel.knownResources;
  c.state.threatSightings = cleanedIntel.threatSightings;

  if (neutralizedThreatIds.length > 0) {
    debrief.notices.push(
      ...neutralizedThreatIds.map((id) => `THREAT DOWN: ${id} neutralized by defenders`),
    );
  }

  if (killedAgentIds.length > 0) {
    const killedSet = new Set(killedAgentIds);
    c.state.agents = c.state.agents.filter((a) => !killedSet.has(a.id));
    debrief.notices.push(
      ...killedAgentIds.map((id) => `FALLEN: ${id} was destroyed — all episodic memory lost`),
    );
  }

  c.state.totalResourcesCollected += debrief.resourcesCollected;
  debrief.totalResources = c.state.totalResourcesCollected;

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

  c.state.debriefs.push(debrief);
  if (c.state.debriefs.length > 50) {
    c.state.debriefs = c.state.debriefs.slice(-50);
  }

  const publicState = getPublicState(c.state);
  c.broadcast("tickCompleted", {
    state: publicState,
    debrief,
  });

  return { state: publicState, debrief };
}

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
  doctrineHistory: DoctrineHistoryEntry[],
  map: GameMap,
  knownResources: Position[],
  threatSightings: ThreatSighting[],
  threats: Threat[],
): {
  debrief: TickDebrief;
  newKnownResources: Position[];
  newThreatSightings: ThreatSighting[];
  killedAgentIds: string[];
  neutralizedThreatIds: string[];
} {
  const newKnownResources: Position[] = [];
  const newThreatSightings: ThreatSighting[] = [];
  const pendingEpisodes: Array<{ agentId: string; record: EpisodeRecord }> = [];

  // Execute agent decisions (each uses the doctrine version they were last updated to).
  // basePosition is canonical world-state — always inject the current value so agents
  // running stale doctrine never navigate to or deposit at an obsolete base.
  const actions = agents.map((agent) => {
    const agentDoctrine = {
      ...resolveDoctrineForAgent(agent, doctrine, doctrineHistory),
      basePosition: doctrine.basePosition,
    };
    return executeAgent(
      agent,
      agentDoctrine,
      map,
      tick,
      knownResources,
      newKnownResources,
      threats,
      pendingEpisodes,
      threatSightings,
      newThreatSightings,
    );
  });

  // Apply actions
  let resourcesCollected = 0;
  for (const action of actions) {
    resourcesCollected += applyAction(action, agents, map, tick, pendingEpisodes, threats);
  }

  const neutralizedThreatIds = threats
    .filter((threat) => threat.hp <= 0)
    .map((threat) => threat.id);

  if (neutralizedThreatIds.length > 0) {
    const neutralizedSet = new Set(neutralizedThreatIds);
    for (let i = threats.length - 1; i >= 0; i--) {
      if (neutralizedSet.has(threats[i].id)) {
        threats.splice(i, 1);
      }
    }
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
    newThreatSightings,
    killedAgentIds,
    neutralizedThreatIds,
  };
}

// --- Helpers ---

/** Resolves and returns the doctrine config for the agent based on its deployedDoctrineVersion, falling back to the current doctrine. */
function resolveDoctrineForAgent(
  agent: Agent,
  current: Doctrine,
  history: DoctrineHistoryEntry[],
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
export function normalizeDoctrine(doctrine: Doctrine): Doctrine {
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

export function getPublicState(state: {
  phase: GamePhase;
  tick: number;
  autoTick: boolean;
  tickIntervalMs: number;
  map: GameMap | null;
  agents: Agent[];
  doctrine: Doctrine;
  doctrineHistory: DoctrineHistoryEntry[];
  basePosition: { x: number; y: number };
  totalResourcesCollected: number;
  debriefs: TickDebrief[];
  knownResources: Position[];
  threats: Threat[];
  threatSightings: ThreatSighting[];
  towers: Tower[];
}): GameState {
  return {
    phase: state.phase,
    tick: state.tick,
    autoTick: state.autoTick,
    tickIntervalMs: state.tickIntervalMs,
    map: state.map!,
    agents: state.agents,
    doctrine: normalizeDoctrine(state.doctrine),
    doctrineHistory: state.doctrineHistory.map((entry): DoctrineRenderSummary => summarizeDoctrineForRender(entry.doctrine)),
    basePosition: state.basePosition,
    totalResourcesCollected: state.totalResourcesCollected,
    debriefs: state.debriefs,
    knownResources: state.knownResources,
    threats: state.threats,
    threatSightings: state.threatSightings,
    towers: state.towers,
  };
}
