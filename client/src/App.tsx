import React, { useState, useCallback, useEffect } from "react";
import type { GameState, TickDebrief, Doctrine } from "@doctrine/shared";
import { useActor } from "./rivet.js";
import { MapView } from "./components/MapView.js";
import { DoctrineEditor } from "./components/DoctrineEditor.js";
import { TickDebriefPanel } from "./components/TickDebriefPanel.js";
import { GameControls } from "./components/GameControls.js";
import { Header } from "./components/Header.js";

export function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [latestDebrief, setLatestDebrief] = useState<TickDebrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoTicking, setAutoTicking] = useState(false);
  const [tickSpeed, setTickSpeed] = useState(1000);
  const [tickSpeedUpdating, setTickSpeedUpdating] = useState(false);

  const world = useActor({ name: "gameWorld", key: ["default"] });

  // Listen for real-time events
  world.useEvent("gameInitialized", (state: GameState) => {
    setGameState(state);
    setLatestDebrief(null);
    setAutoTicking(state.autoTick);
    setTickSpeed(state.tickIntervalMs);
  });

  world.useEvent("tickCompleted", (data: { state: GameState; debrief: TickDebrief }) => {
    setGameState(data.state);
    setLatestDebrief(data.debrief);
    setAutoTicking(data.state.autoTick);
  });

  world.useEvent("doctrineDeployed", (state: GameState) => {
    setGameState(state);
  });

  world.useEvent("autoTickChanged", (data: { autoTick: boolean }) => {
    setAutoTicking(data.autoTick);
  });

  world.useEvent("tickIntervalChanged", (data: { tickIntervalMs: number }) => {
    setTickSpeed(data.tickIntervalMs);
  });

  // Initialize game on first connection
  useEffect(() => {
    if (world.connection && !gameState) {
      world.connection
        .initGame()
        .then((state: GameState) => {
          setGameState(state);
          setAutoTicking(state.autoTick);
          setTickSpeed(state.tickIntervalMs);
        })
        .catch((err: Error) => setError(err.message));
    }
  }, [world.connection, gameState]);

  const handleTick = useCallback(async () => {
    if (!world.connection) return;
    try {
      const result = await world.connection.executeTick();
      setGameState(result.state);
      setLatestDebrief(result.debrief);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Tick failed");
    }
  }, [world.connection]);

  const handleDeployDoctrine = useCallback(
    async (doctrine: Doctrine) => {
      if (!world.connection) return;
      try {
        await world.connection.deployDoctrine(doctrine);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    },
    [world.connection],
  );

  const handleReset = useCallback(async () => {
    if (!world.connection) return;
    try {
      const state = await world.connection.initGame();
      setGameState(state);
      setLatestDebrief(null);
      setAutoTicking(state.autoTick);
      setTickSpeed(state.tickIntervalMs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }, [world.connection]);

  const handleToggleAutoTick = useCallback(async () => {
    if (!world.connection) return;
    try {
      if (autoTicking) {
        const result = await world.connection.stopAutoTick();
        setAutoTicking(result.autoTick);
      } else {
        const result = await world.connection.startAutoTick();
        setAutoTicking(result.autoTick);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Auto-tick toggle failed");
    }
  }, [autoTicking, world.connection]);

  const handleTickSpeedChange = useCallback(
    async (ms: number) => {
      if (!world.connection) return;
      if (tickSpeedUpdating) return;

      setTickSpeedUpdating(true);
      try {
        const result = await world.connection.setTickInterval(ms);
        setTickSpeed(result.tickIntervalMs);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Tick speed update failed");
      } finally {
        setTickSpeedUpdating(false);
      }
    },
    [tickSpeedUpdating, world.connection],
  );

  if (error) {
    return (
      <div className="app-error">
        <h2>Error</h2>
        <p>{error}</p>
        <button type="button" onClick={() => setError(null)}>Dismiss</button>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="app-loading">
        <h2>DOCTRINE</h2>
        <p>Connecting to game world...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        tick={gameState.tick}
        phase={gameState.phase}
        totalResources={gameState.totalResourcesCollected}
        doctrineVersion={gameState.doctrine.version}
      />
      <div className="app-layout">
        <div className="app-main">
          <MapView
            map={gameState.map}
            agents={gameState.agents}
            basePosition={gameState.basePosition}
            currentTick={gameState.tick}
            threats={gameState.threats ?? []}
            threatSightings={gameState.threatSightings ?? []}
            towers={gameState.towers ?? []}
            doctrine={gameState.doctrine}
            doctrineHistory={gameState.doctrineHistory ?? []}
          />
          <GameControls
            onTick={handleTick}
            onReset={handleReset}
            onToggleAutoTick={handleToggleAutoTick}
            autoTicking={autoTicking}
            tickSpeed={tickSpeed}
            tickSpeedUpdating={tickSpeedUpdating}
            onTickSpeedChange={handleTickSpeedChange}
          />
        </div>
        <div className="app-sidebar">
          <DoctrineEditor doctrine={gameState.doctrine} onDeploy={handleDeployDoctrine} />
          <TickDebriefPanel
            debrief={latestDebrief}
            agents={gameState.agents}
            doctrine={gameState.doctrine}
            doctrineHistory={gameState.doctrineHistory ?? []}
            threatSightings={gameState.threatSightings ?? []}
          />
        </div>
      </div>
    </div>
  );
}
