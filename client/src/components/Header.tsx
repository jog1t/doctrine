import React from "react";
import type { GamePhase } from "@doctrine/shared";

interface HeaderProps {
  tick: number;
  phase: GamePhase;
  totalResources: number;
  doctrineVersion: number;
}

export function Header({ tick, phase, totalResources, doctrineVersion }: HeaderProps) {
  return (
    <header className="header">
      <h1 className="header-title">DOCTRINE</h1>
      <div className="header-stats">
        <span className="stat">
          <span className="stat-label">TICK</span>
          <span className="stat-value">{tick}</span>
        </span>
        <span className="stat">
          <span className="stat-label">PHASE</span>
          <span className={`stat-value phase-${phase}`}>{phase.toUpperCase()}</span>
        </span>
        <span className="stat">
          <span className="stat-label">RESOURCES</span>
          <span className="stat-value">{totalResources}</span>
        </span>
        <span className="stat">
          <span className="stat-label">DOCTRINE v</span>
          <span className="stat-value">{doctrineVersion}</span>
        </span>
      </div>
    </header>
  );
}
