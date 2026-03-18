import { describe, expect, it } from "vitest";
import { DEFAULT_DOCTRINE } from "@doctrine/shared";
import { setupTest } from "rivetkit/test";
import {
  cleanupThreatSightings,
  cleanupWorldIntel,
  type GameWorldRuntimeState,
  getPublicState,
  normalizeDoctrine,
  upsertThreatSighting,
} from "../actors/game-world.js";
import { registry } from "../actors/registry.js";
import { makeAgent, makeDoctrine, makeMap, makeThreat, makeTower, placeResource } from "./helpers.js";

describe("normalizeDoctrine", () => {
  it("fills threat intel fields for persisted older doctrine data", () => {
    const legacyDoctrine = {
      ...makeDoctrine(),
      scout: {
        patrolRadius: 9,
        patrolPattern: "grid" as const,
        lingerTicks: 1,
        reportResourceFinds: true,
        memory: { maxEpisodes: 10, decayAfterTicks: 20 },
      },
      defender: {
        guardRadius: 3,
        chaseThreats: true,
        maxChaseDistance: 5,
        memory: { maxEpisodes: 8, decayAfterTicks: 12 },
      },
    } as typeof DEFAULT_DOCTRINE;

    const normalized = normalizeDoctrine(legacyDoctrine);

    expect(normalized.scout.threatReportRadius).toBe(DEFAULT_DOCTRINE.scout.threatReportRadius);
    expect(normalized.defender.maxInvestigateDistance).toBe(
      DEFAULT_DOCTRINE.defender.maxInvestigateDistance,
    );
    expect(normalized.defender.maxChaseDistance).toBe(5);
  });
});

describe("threat sighting helpers", () => {
  it("replaces an older sighting for the same threat with a fresher one", () => {
    const sightings = upsertThreatSighting(
      [{ threatId: "threat-0", position: { x: 4, y: 4 }, lastSeenTick: 3 }],
      { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
    );

    expect(sightings).toEqual([
      { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
    ]);
  });

  it("keeps the fresher stored sighting when an older update arrives", () => {
    const sightings = upsertThreatSighting(
      [{ threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 }],
      { threatId: "threat-0", position: { x: 4, y: 4 }, lastSeenTick: 3 },
    );

    expect(sightings).toEqual([
      { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
    ]);
  });

  it("drops sightings for expired or removed threats", () => {
    const remaining = cleanupThreatSightings(
      [
        { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
        { threatId: "threat-1", position: { x: 1, y: 2 }, lastSeenTick: 30 },
      ],
      [makeThreat("threat-1", { x: 1, y: 2 })],
      50,
    );

    expect(remaining).toEqual([{ threatId: "threat-1", position: { x: 1, y: 2 }, lastSeenTick: 30 }]);
  });
});

describe("world intel cleanup business logic", () => {
  it("expires stale threat intel while preserving still-valid world intel in the same cleanup pass", () => {
    const map = makeMap();
    placeResource(map, 4, 4, 3);

    const result = cleanupWorldIntel({
      map,
      knownResources: [
        { x: 4, y: 4 },
        { x: 8, y: 8 },
      ],
      threats: [makeThreat("threat-1", { x: 10, y: 10 })],
      threatSightings: [
        { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
        { threatId: "threat-1", position: { x: 10, y: 10 }, lastSeenTick: 30 },
      ],
      tick: 50,
    });

    expect(result.knownResources).toEqual([{ x: 4, y: 4 }]);
    expect(result.threatSightings).toEqual([
      { threatId: "threat-1", position: { x: 10, y: 10 }, lastSeenTick: 30 },
    ]);
  });
});

describe("getPublicState", () => {
  it("exposes threatSightings in public game state", () => {
    const state = getPublicState({
      phase: "running",
      tick: 4,
      map: makeMap(),
      agents: [makeAgent("scout-0", "scout", { x: 16, y: 12 })],
      doctrine: makeDoctrine(),
      doctrineHistory: [],
      basePosition: { x: 16, y: 12 },
      totalResourcesCollected: 0,
      debriefs: [],
      knownResources: [],
      threats: [makeThreat("threat-0", { x: 20, y: 12 })],
      threatSightings: [{ threatId: "threat-0", position: { x: 19, y: 12 }, lastSeenTick: 4 }],
      towers: [makeTower("tower-0", { x: 16, y: 12 })],
    });

    expect(state.threatSightings).toEqual([
      { threatId: "threat-0", position: { x: 19, y: 12 }, lastSeenTick: 4 },
    ]);
  });
});

describe("gameWorld executeTick", () => {
  it("expires stale threat intel through the actor action flow", async (c) => {
    const { client } = await setupTest(c, registry);
    const handle = client.gameWorld.getOrCreate(["execute-tick-intel-expiry"]);

    await handle.initGame(123);

    const gatewayUrl = await handle.getGatewayUrl();
    const stateResponse = await fetch(`${gatewayUrl}/inspector/state`, {
      headers: { Authorization: "Bearer token" },
    });
    expect(stateResponse.status).toBe(200);

    const inspectorPayload = (await stateResponse.json()) as { state: GameWorldRuntimeState };
    const actorState = inspectorPayload.state;
    actorState.tick = 49;
    actorState.threats = [makeThreat("threat-1", { x: 20, y: 12 })];
    actorState.threatSightings = [
      { threatId: "threat-0", position: { x: 7, y: 6 }, lastSeenTick: 5 },
      { threatId: "threat-1", position: { x: 19, y: 12 }, lastSeenTick: 30 },
    ];

    const patchResponse = await fetch(`${gatewayUrl}/inspector/state`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({ state: actorState }),
    });
    expect(patchResponse.status).toBe(200);

    const result = await handle.executeTick();

    expect(result.state.tick).toBe(50);
    expect(result.debrief.tick).toBe(50);
    expect(result.state.threatSightings).toHaveLength(1);
    expect(result.state.threatSightings[0]).toMatchObject({
      threatId: "threat-1",
      position: { x: 20, y: 12 },
      lastSeenTick: 50,
    });
  });

  it("refreshes threat intel through scout reporting during executeTick", async (c) => {
    const { client } = await setupTest(c, registry);
    const handle = client.gameWorld.getOrCreate(["execute-tick-threat-reporting"]);

    await handle.initGame(123);

    const gatewayUrl = await handle.getGatewayUrl();
    const stateResponse = await fetch(`${gatewayUrl}/inspector/state`, {
      headers: { Authorization: "Bearer token" },
    });
    expect(stateResponse.status).toBe(200);

    const inspectorPayload = (await stateResponse.json()) as { state: GameWorldRuntimeState };
    const actorState = inspectorPayload.state;
    actorState.tick = 4;
    actorState.agents = [makeAgent("scout-0", "scout", { x: 16, y: 12 })];
    actorState.threats = [makeThreat("threat-0", { x: 18, y: 12 })];
    actorState.threatSightings = [];

    const patchResponse = await fetch(`${gatewayUrl}/inspector/state`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({ state: actorState }),
    });
    expect(patchResponse.status).toBe(200);

    const result = await handle.executeTick();

    expect(result.state.tick).toBe(5);
    expect(result.state.threatSightings).toEqual([
      { threatId: "threat-0", position: { x: 18, y: 12 }, lastSeenTick: 5 },
    ]);
  });
});
