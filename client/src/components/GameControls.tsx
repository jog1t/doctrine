import React from "react";

interface GameControlsProps {
  onTick: () => void;
  onReset: () => void;
  onToggleAutoTick: () => void;
  autoTicking: boolean;
  tickSpeed: number;
  tickSpeedUpdating: boolean;
  onTickSpeedChange: (ms: number) => void;
}

export function GameControls({
  onTick,
  onReset,
  onToggleAutoTick,
  autoTicking,
  tickSpeed,
  tickSpeedUpdating,
  onTickSpeedChange,
}: GameControlsProps) {
  return (
    <div className="game-controls">
      <button type="button" className="btn btn-primary" onClick={onTick} disabled={autoTicking}>
        TICK
      </button>
      <button
        type="button"
        className={`btn ${autoTicking ? "btn-stop" : "btn-start"}`}
        onClick={onToggleAutoTick}
      >
        {autoTicking ? "STOP" : "START"}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        RESET
      </button>
      <div className="speed-control">
        <label htmlFor="tick-speed">SPEED</label>
        <input
          id="tick-speed"
          type="range"
          min={100}
          max={2000}
          step={100}
          value={tickSpeed}
          disabled={tickSpeedUpdating}
          onChange={(e) => onTickSpeedChange(Number(e.target.value))}
        />
        <span className="speed-value">{tickSpeed}ms</span>
      </div>
    </div>
  );
}
