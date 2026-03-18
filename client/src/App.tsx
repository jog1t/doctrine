import React, { useState, useCallback, useEffect, useRef } from "react";
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
  const autoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tickSpeed, setTickSpeed] = useState(1000);

  const world = useActor({ name: "gameWorld", key: ["default"] });

  // Listen for real-time events
  world.useEvent("gameInitialized", (state: GameState) => {
    setGameState(state);
    setLatestDebrief(null);
  });

  world.useEvent("tickCompleted", (data: { state: GameState; debrief: TickDebrief }) => {
    setGameState(data.state);
    setLatestDebrief(data.debrief);
  });

  world.useEvent("doctrineDeployed", (state: GameState) => {
    setGameState(state);
  });

  // Initialize game on first connection
  useEffect(() => {
    if (world.connection && !gameState) {
      world.connection
        .initGame()
        .then((state: GameState) => {
          setGameState(state);
        })
        .catch((err: Error) => setError(err.message));
    }
  }, [world.connection, gameState]);

  // Auto-tick loop (client-driven for simplicity in M1)
  useEffect(() => {
    if (autoTicking && world.connection) {
      autoTickRef.current = setInterval(() => {
        world.connection?.executeTick().catch(() => {});
      }, tickSpeed);
    }
    return () => {
      if (autoTickRef.current) clearInterval(autoTickRef.current);
    };
  }, [autoTicking, tickSpeed, world.connection]);

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
    setAutoTicking(false);
    try {
      const state = await world.connection.initGame();
      setGameState(state);
      setLatestDebrief(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }, [world.connection]);

  const handleToggleAutoTick = useCallback(() => {
    setAutoTicking((prev) => !prev);
  }, []);

  if (error) {
    return (
      <div className="app-error">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => setError(null)}>Dismiss</button>
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
            previousDoctrine={gameState.previousDoctrine}
          />
          <GameControls
            onTick={handleTick}
            onReset={handleReset}
            onToggleAutoTick={handleToggleAutoTick}
            autoTicking={autoTicking}
            tickSpeed={tickSpeed}
            onTickSpeedChange={setTickSpeed}
          />
        </div>
        <div className="app-sidebar">
          <DoctrineEditor doctrine={gameState.doctrine} onDeploy={handleDeployDoctrine} />
          <TickDebriefPanel
            debrief={latestDebrief}
            agents={gameState.agents}
            doctrine={gameState.doctrine}
            previousDoctrine={gameState.previousDoctrine}
            threatSightings={gameState.threatSightings ?? []}
          />
        </div>
      </div>
    </div>
  );
}
