import { describe, it, expect } from "vitest";
import type { EpisodeRecord } from "@doctrine/shared";
import { executeAgent, applyAction, applyMemoryUpdates, moveThreat, applyThreatDamage } from "../engine/agent-logic.js";
import { makeMap, makeAgent, makeThreat, makeDoctrine, placeResource, placeObstacle } from "./helpers.js";

// ============================================================
// Gatherer — working memory
// ============================================================

describe("gatherer working memory", () => {
  it("commits to a resource target in working memory on first evaluation", () => {
    const map = makeMap();
    placeResource(map, 5, 12, 5);
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });
    // Use a searchRadius large enough to find the resource at (5,12) from (16,12) — dist 11
    const doctrine = makeDoctrine({ gatherer: { ...makeDoctrine().gatherer, searchRadius: 15, preferScoutIntel: false } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(agent.workingMemory.currentTask).toBe("gather");
    expect(agent.workingMemory.taskTarget).toMatchObject({ x: 5, y: 12 });
    expect(agent.workingMemory.taskStartTick).toBe(1);
  });

  it("continues toward committed target on subsequent tick without re-evaluating", () => {
    const map = makeMap();
    placeResource(map, 3, 12, 5);
    placeResource(map, 20, 12, 10); // richer resource further away
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 }, {
      workingMemory: { currentTask: "gather", taskTarget: { x: 3, y: 12 }, taskStartTick: 1 },
    });
    const doctrine = makeDoctrine();
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 2, [], [], [], pending);

    // Should still head toward (3,12) — committed target — not the richer one
    expect(action.action).toBe("move");
    expect(action.reason).toContain("working memory");
  });

  it("clears working memory and records episode when target is depleted", () => {
    const map = makeMap();
    // Resource at (5,12) starts depleted
    map.tiles[12][5] = { type: "empty", resources: 0 };
    const agent = makeAgent("gatherer-0", "gatherer", { x: 6, y: 12 }, {
      workingMemory: { currentTask: "gather", taskTarget: { x: 5, y: 12 }, taskStartTick: 1 },
    });
    const doctrine = makeDoctrine();
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 3, [], [], [], pending);

    expect(agent.workingMemory.currentTask).toBeNull();
    expect(pending.some((e) => e.record.eventType === "resource-depleted")).toBe(true);
  });

  it("sets working memory to return when carrying enough", () => {
    const map = makeMap();
    // Agent away from base (base is at 16,12) so it returns rather than deposits
    const agent = makeAgent("gatherer-0", "gatherer", { x: 5, y: 5 }, { carrying: 3 });
    const doctrine = makeDoctrine({ gatherer: { ...makeDoctrine().gatherer, returnThreshold: 3 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(agent.workingMemory.currentTask).toBe("return");
  });

  it("deposits and clears working memory when at base", () => {
    const map = makeMap();
    const base = { x: 16, y: 12 };
    const agent = makeAgent("gatherer-0", "gatherer", base, { carrying: 3 });
    const doctrine = makeDoctrine({ gatherer: { ...makeDoctrine().gatherer, returnThreshold: 3 }, basePosition: base });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(action.action).toBe("deposit");
    // Apply the action to trigger working memory clear
    applyAction(action, [agent], map, 1, pending);
    expect(agent.workingMemory.currentTask).toBeNull();
  });
});

// ============================================================
// Gatherer — scout intel preference
// ============================================================

describe("gatherer scout intel preference", () => {
  it("prefers scout intel over local scan when preferScoutIntel=true", () => {
    const map = makeMap();
    placeResource(map, 15, 12, 2); // local, closer
    const knownFar = { x: 5, y: 12 };
    placeResource(map, knownFar.x, knownFar.y, 8);
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ gatherer: { ...makeDoctrine().gatherer, preferScoutIntel: true, searchRadius: 20 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [knownFar], [], [], pending);

    expect(action.action).toBe("move-intel");
  });

  it("falls back to local scan when preferScoutIntel=false", () => {
    const map = makeMap();
    placeResource(map, 15, 12, 2); // local, within searchRadius
    const knownFar = { x: 5, y: 12 };
    placeResource(map, knownFar.x, knownFar.y, 8);
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ gatherer: { ...makeDoctrine().gatherer, preferScoutIntel: false, searchRadius: 5 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [knownFar], [], [], pending);

    expect(action.action).toBe("move");
    expect(action.reason).toContain("Scan");
  });

  it("idles when no resources and no known resources", () => {
    const map = makeMap();
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });
    const doctrine = makeDoctrine();
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(action.action).toBe("idle");
  });
});

// ============================================================
// Scout — patrol patterns and reporting
// ============================================================

describe("scout patrol and reporting", () => {
  it("records resource-found episode when reportResourceFinds=true and resource visible", () => {
    const map = makeMap();
    placeResource(map, 16, 12, 5); // on agent's position (within vision)
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, reportResourceFinds: true } });
    const newKnown: Array<{ x: number; y: number }> = [];
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], newKnown, [], pending);

    expect(newKnown.length).toBeGreaterThan(0);
    expect(pending.some((e) => e.record.eventType === "resource-found")).toBe(true);
  });

  it("does not report resources when reportResourceFinds=false", () => {
    const map = makeMap();
    placeResource(map, 16, 12, 5);
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, reportResourceFinds: false } });
    const newKnown: Array<{ x: number; y: number }> = [];
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], newKnown, [], pending);

    expect(newKnown.length).toBe(0);
    expect(pending.some((e) => e.record.eventType === "resource-found")).toBe(false);
  });

  it("uses grid patrol pattern and moves toward sector target", () => {
    const map = makeMap();
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, patrolPattern: "grid" } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(["move", "observe"]).toContain(action.action);
    if (action.action === "move") {
      expect(action.reason).toContain("grid");
    }
  });

  it("uses perimeter patrol pattern", () => {
    const map = makeMap();
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, patrolPattern: "perimeter" } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    if (action.action === "move") {
      expect(action.reason).toContain("perimeter");
    }
  });

  it("uses spiral patrol pattern", () => {
    const map = makeMap();
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, patrolPattern: "spiral" } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    if (action.action === "move") {
      expect(action.reason).toContain("spiral");
    }
  });

  it("sets working memory patrol task", () => {
    const map = makeMap();
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 });
    const doctrine = makeDoctrine();
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(agent.workingMemory.currentTask).toBe("patrol");
    expect(agent.workingMemory.taskTarget).not.toBeNull();
  });
});

// ============================================================
// Defender — threat awareness and working memory
// ============================================================

describe("defender threat behavior", () => {
  it("guards base when no threats", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const doctrine = makeDoctrine({ defender: { ...makeDoctrine().defender, guardRadius: 4 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(action.action).toBe("guard");
  });

  it("chases nearby threat when chaseThreats=true and within maxChaseDistance", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const threat = makeThreat("threat-0", { x: 18, y: 12 }); // distance 2, within visionRadius=3
    const doctrine = makeDoctrine({
      defender: { ...makeDoctrine().defender, chaseThreats: true, maxChaseDistance: 6, guardRadius: 4 },
    });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [threat], pending);

    expect(action.action).toBe("move");
    expect(action.reason).toContain("Engaging threat");
  });

  it("records threat-spotted episode on first sighting", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const threat = makeThreat("threat-0", { x: 18, y: 12 });
    const doctrine = makeDoctrine({ defender: { ...makeDoctrine().defender, chaseThreats: true } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], [], [threat], pending);

    expect(pending.some((e) => e.record.eventType === "threat-spotted")).toBe(true);
  });

  it("does not record duplicate threat-spotted for same threat within 5 ticks", () => {
    const map = makeMap();
    const threat = makeThreat("threat-0", { x: 18, y: 12 });
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 }, {
      episodes: [{
        tick: 1,
        eventType: "threat-spotted",
        position: { x: 18, y: 12 },
        detail: "Spotted threat threat-0 at distance 2",
      }],
    });
    const doctrine = makeDoctrine({ defender: { ...makeDoctrine().defender, chaseThreats: true } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 3, [], [], [threat], pending); // tick 3, within 5 of tick 1

    const spotEpisodes = pending.filter((e) => e.record.eventType === "threat-spotted");
    expect(spotEpisodes.length).toBe(0);
  });

  it("holds position when chaseThreats=false even with visible threat", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const threat = makeThreat("threat-0", { x: 17, y: 12 });
    const doctrine = makeDoctrine({
      defender: { ...makeDoctrine().defender, chaseThreats: false, guardRadius: 4 },
    });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [threat], pending);

    expect(action.action).toBe("guard");
  });

  it("ignores threats beyond maxChaseDistance", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const threat = makeThreat("threat-0", { x: 18, y: 12 }); // dist 2, within vision
    const doctrine = makeDoctrine({
      defender: { ...makeDoctrine().defender, chaseThreats: true, maxChaseDistance: 1 },
    });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [threat], pending);

    // maxChaseDistance=1 but dist=2, so should not chase
    expect(action.action).toBe("guard");
  });

  it("sets chase working memory when engaging threat", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 16, y: 12 });
    const threat = makeThreat("threat-0", { x: 18, y: 12 });
    const doctrine = makeDoctrine({
      defender: { ...makeDoctrine().defender, chaseThreats: true, maxChaseDistance: 6 },
    });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 1, [], [], [threat], pending);

    expect(agent.workingMemory.currentTask).toBe("chase:threat-0");
    expect(agent.workingMemory.taskTarget).toMatchObject({ x: 18, y: 12 });
  });

  it("returns to base when beyond guardRadius", () => {
    const map = makeMap();
    const agent = makeAgent("defender-0", "defender", { x: 0, y: 0 }); // far from base at (16,12)
    const doctrine = makeDoctrine({ defender: { ...makeDoctrine().defender, guardRadius: 4 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(action.action).toBe("move");
    expect(action.reason).toContain("returning");
  });
});

// ============================================================
// applyAction
// ============================================================

describe("applyAction", () => {
  it("moves agent to new position", () => {
    const map = makeMap();
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    applyAction(
      { agentId: "gatherer-0", agentType: "gatherer", action: "move", reason: "", from: { x: 10, y: 10 }, to: { x: 11, y: 10 }, doctrineVersion: 1 },
      [agent],
      map,
      1,
      pending,
    );

    expect(agent.position).toMatchObject({ x: 11, y: 10 });
    expect(agent.status).toBe("moving");
  });

  it("gathers resource and decrements tile", () => {
    const map = makeMap();
    placeResource(map, 10, 10, 5);
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    applyAction(
      { agentId: "gatherer-0", agentType: "gatherer", action: "gather", reason: "", from: { x: 10, y: 10 }, to: null, doctrineVersion: 1 },
      [agent],
      map,
      1,
      pending,
    );

    expect(agent.carrying).toBe(1);
    expect(map.tiles[10][10].resources).toBe(4);
  });

  it("records resource-depleted episode when tile exhausted", () => {
    const map = makeMap();
    placeResource(map, 10, 10, 1); // last resource
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    applyAction(
      { agentId: "gatherer-0", agentType: "gatherer", action: "gather", reason: "", from: { x: 10, y: 10 }, to: null, doctrineVersion: 1 },
      [agent],
      map,
      1,
      pending,
    );

    expect(map.tiles[10][10].type).toBe("empty");
    expect(pending.some((e) => e.record.eventType === "resource-depleted")).toBe(true);
  });

  it("deposits resources and returns collected count", () => {
    const map = makeMap();
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 }, { carrying: 3 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const collected = applyAction(
      { agentId: "gatherer-0", agentType: "gatherer", action: "deposit", reason: "", from: { x: 16, y: 12 }, to: { x: 16, y: 12 }, doctrineVersion: 1 },
      [agent],
      map,
      1,
      pending,
    );

    expect(collected).toBe(3);
    expect(agent.carrying).toBe(0);
    expect(pending.some((e) => e.record.eventType === "task-completed")).toBe(true);
  });
});

// ============================================================
// Episodic memory decay
// ============================================================

describe("applyMemoryUpdates", () => {
  it("appends pending episodes to agents", () => {
    const agents = [makeAgent("scout-0", "scout", { x: 16, y: 12 })];
    const doctrine = makeDoctrine();
    const pending = [
      { agentId: "scout-0", record: { tick: 1, eventType: "resource-found" as const, position: { x: 5, y: 5 }, detail: "test" } },
    ];

    applyMemoryUpdates(agents, doctrine, pending, 1, []);

    expect(agents[0].episodes.length).toBe(1);
    expect(agents[0].episodes[0].eventType).toBe("resource-found");
  });

  it("trims episodes beyond maxEpisodes (keeps most recent)", () => {
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 }, {
      episodes: Array.from({ length: 19 }, (_, i) => ({
        tick: i + 1,
        eventType: "resource-found" as const,
        position: { x: i, y: 0 },
        detail: `ep${i}`,
      })),
    });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, memory: { maxEpisodes: 20, decayAfterTicks: 0 } } });
    const pending = [
      { agentId: "scout-0", record: { tick: 20, eventType: "resource-found" as const, position: { x: 20, y: 0 }, detail: "ep20" } },
      { agentId: "scout-0", record: { tick: 21, eventType: "resource-found" as const, position: { x: 21, y: 0 }, detail: "ep21" } },
    ];

    applyMemoryUpdates([agent], doctrine, pending, 21, []);

    expect(agent.episodes.length).toBe(20);
    // Should keep the 20 most recent
    expect(agent.episodes[agent.episodes.length - 1].detail).toBe("ep21");
  });

  it("drops episodes older than decayAfterTicks", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 }, {
      episodes: [
        { tick: 1, eventType: "resource-found" as const, position: { x: 1, y: 0 }, detail: "old" },
        { tick: 25, eventType: "resource-found" as const, position: { x: 2, y: 0 }, detail: "recent" },
      ],
    });
    const doctrine = makeDoctrine({
      gatherer: { ...makeDoctrine().gatherer, memory: { maxEpisodes: 10, decayAfterTicks: 10 } },
    });

    applyMemoryUpdates([agent], doctrine, [], 30, []); // tick 30: episode at tick 1 is 29 ticks old > 10

    expect(agent.episodes.length).toBe(1);
    expect(agent.episodes[0].detail).toBe("recent");
  });

  it("retains all episodes when decayAfterTicks=0", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 }, {
      episodes: [
        { tick: 1, eventType: "resource-found" as const, position: { x: 1, y: 0 }, detail: "old" },
      ],
    });
    const doctrine = makeDoctrine({
      gatherer: { ...makeDoctrine().gatherer, memory: { maxEpisodes: 100, decayAfterTicks: 0 } },
    });

    applyMemoryUpdates([agent], doctrine, [], 1000, []);

    expect(agent.episodes.length).toBe(1);
  });

  it("ignores pending episodes for unknown agent ids", () => {
    const agents = [makeAgent("scout-0", "scout", { x: 16, y: 12 })];
    const doctrine = makeDoctrine();
    const pending = [
      { agentId: "nonexistent", record: { tick: 1, eventType: "resource-found" as const, position: { x: 0, y: 0 }, detail: "" } },
    ];

    applyMemoryUpdates(agents, doctrine, pending, 1, []);

    expect(agents[0].episodes.length).toBe(0);
  });
});

// ============================================================
// Threat movement and damage
// ============================================================

describe("threat mechanics", () => {
  it("moves threat one step toward nearest agent", () => {
    const map = makeMap();
    const threat = makeThreat("threat-0", { x: 10, y: 12 });
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });

    moveThreat(threat, [agent], map);

    // Should move right toward agent
    expect(threat.position.x).toBe(11);
    expect(threat.position.y).toBe(12);
  });

  it("moves threat around obstacles", () => {
    const map = makeMap();
    const threat = makeThreat("threat-0", { x: 10, y: 12 });
    placeObstacle(map, 11, 12); // block direct path
    const agent = makeAgent("gatherer-0", "gatherer", { x: 16, y: 12 });

    moveThreat(threat, [agent], map);

    // Can't go to (11,12) — should sidestep
    expect(threat.position).not.toMatchObject({ x: 11, y: 12 });
  });

  it("deals 1 damage to agent on same tile", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 }, { hp: 5, maxHp: 5 });
    const threat = makeThreat("threat-0", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    applyThreatDamage([threat], [agent], 1, pending);

    expect(agent.hp).toBe(4);
    expect(pending.some((e) => e.record.eventType === "damage-taken")).toBe(true);
  });

  it("returns killed agent ids when hp reaches 0", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 }, { hp: 1, maxHp: 5 });
    const threat = makeThreat("threat-0", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const killed = applyThreatDamage([threat], [agent], 1, pending);

    expect(killed).toContain("gatherer-0");
  });

  it("does not kill agent above 1 hp", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 10, y: 10 }, { hp: 3, maxHp: 5 });
    const threat = makeThreat("threat-0", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const killed = applyThreatDamage([threat], [agent], 1, pending);

    expect(killed).not.toContain("gatherer-0");
    expect(agent.hp).toBe(2);
  });

  it("does not damage agent on different tile", () => {
    const agent = makeAgent("gatherer-0", "gatherer", { x: 11, y: 10 }, { hp: 5, maxHp: 5 });
    const threat = makeThreat("threat-0", { x: 10, y: 10 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    applyThreatDamage([threat], [agent], 1, pending);

    expect(agent.hp).toBe(5);
    expect(pending.length).toBe(0);
  });

  it("does nothing when no agents", () => {
    const map = makeMap();
    const threat = makeThreat("threat-0", { x: 10, y: 10 });
    const originalPos = { ...threat.position };

    moveThreat(threat, [], map);

    expect(threat.position).toMatchObject(originalPos);
  });
});

// ============================================================
// Doctrine version assignment
// ============================================================

describe("agent doctrine version in actions", () => {
  it("action carries the doctrine version used", () => {
    const map = makeMap();
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 }, { deployedDoctrineVersion: 2 });
    const doctrine = makeDoctrine({ version: 2 });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 1, [], [], [], pending);

    expect(action.doctrineVersion).toBe(2);
  });
});

// ============================================================
// Scout working memory: committed target drives movement
// ============================================================

describe("scout committed working memory target", () => {
  it("moves toward the committed working-memory target, not a freshly recomputed one", () => {
    const map = makeMap();
    // Scout starts somewhere in the middle
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 }, {
      workingMemory: {
        currentTask: "patrol",
        taskTarget: { x: 5, y: 5 }, // committed to (5,5)
        taskStartTick: 1,
      },
    });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, patrolPattern: "grid", lingerTicks: 0 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    const action = executeAgent(agent, doctrine, map, 2, [], [], [], pending);

    // Should still be heading toward committed (5,5), not a new tick-based target
    expect(action.action).toBe("move");
    expect(action.reason).toContain("(5, 5)");
  });

  it("commits to a new target once the current committed target is reached", () => {
    const map = makeMap();
    // Scout already AT the committed target
    const agent = makeAgent("scout-0", "scout", { x: 5, y: 5 }, {
      workingMemory: {
        currentTask: "patrol",
        taskTarget: { x: 5, y: 5 }, // already at target
        taskStartTick: 1,
      },
    });
    const doctrine = makeDoctrine({ scout: { ...makeDoctrine().scout, patrolPattern: "grid", lingerTicks: 0 } });
    const pending: Array<{ agentId: string; record: EpisodeRecord }> = [];

    executeAgent(agent, doctrine, map, 100, [], [], [], pending); // tick 100 — atTarget=true, so commits to new targetPos

    // Working memory should have been updated to a new (different) target
    expect(agent.workingMemory.taskTarget).not.toMatchObject({ x: 5, y: 5 });
  });
});

// ============================================================
// Doctrine history: resolves correct config for multi-version-behind agent
// ============================================================

describe("applyMemoryUpdates with doctrine history", () => {
  it("uses the matching historical doctrine's memory config for an agent 2 versions behind", () => {
    // Current doctrine (v3) has maxEpisodes=5; the agent is on v1 which has maxEpisodes=50
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 }, {
      deployedDoctrineVersion: 1,
      episodes: Array.from({ length: 10 }, (_, i) => ({
        tick: i + 1,
        eventType: "resource-found" as const,
        position: { x: i, y: 0 },
        detail: `ep${i}`,
      })),
    });
    const currentDoctrine = makeDoctrine({
      version: 3,
      scout: { ...makeDoctrine().scout, memory: { maxEpisodes: 5, decayAfterTicks: 0 } },
    });
    const v1Doctrine = makeDoctrine({
      version: 1,
      scout: { ...makeDoctrine().scout, memory: { maxEpisodes: 50, decayAfterTicks: 0 } },
    });
    const history = [
      { version: 1, doctrine: v1Doctrine },
      { version: 2, doctrine: makeDoctrine({ version: 2 }) },
    ];

    applyMemoryUpdates([agent], currentDoctrine, [], 10, history);

    // Agent is on v1 (maxEpisodes=50), so all 10 episodes should be kept
    expect(agent.episodes.length).toBe(10);
  });

  it("falls back to current doctrine when agent version not found in history", () => {
    const agent = makeAgent("scout-0", "scout", { x: 16, y: 12 }, {
      deployedDoctrineVersion: 99, // unknown version
      episodes: Array.from({ length: 10 }, (_, i) => ({
        tick: i + 1,
        eventType: "resource-found" as const,
        position: { x: i, y: 0 },
        detail: `ep${i}`,
      })),
    });
    const currentDoctrine = makeDoctrine({
      version: 3,
      scout: { ...makeDoctrine().scout, memory: { maxEpisodes: 5, decayAfterTicks: 0 } },
    });

    applyMemoryUpdates([agent], currentDoctrine, [], 10, []);

    // Falls back to current doctrine (maxEpisodes=5), trims to 5
    expect(agent.episodes.length).toBe(5);
  });
});
