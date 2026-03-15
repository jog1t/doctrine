import React from "react";
import type { GameMap, Agent, Position } from "@doctrine/shared";

interface MapViewProps {
  map: GameMap;
  agents: Agent[];
  basePosition: Position;
}

const TILE_SIZE = 22;

const TILE_COLORS: Record<string, string> = {
  empty: "#2a2a28",
  resource: "#4a6741",
  obstacle: "#1a1a18",
};

const AGENT_COLORS: Record<string, string> = {
  gatherer: "#c4a35a",
  scout: "#5a8fc4",
  defender: "#c45a5a",
};

const STATUS_SHAPES: Record<string, string> = {
  idle: "circle",
  moving: "triangle",
  gathering: "diamond",
  scouting: "circle",
  defending: "square",
  returning: "triangle",
};

export function MapView({ map, agents, basePosition }: MapViewProps) {
  if (!map) return null;

  const width = map.width * TILE_SIZE;
  const height = map.height * TILE_SIZE;

  return (
    <div className="map-container">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="map-svg"
      >
        {/* Tiles */}
        {map.tiles.map((row, y) =>
          row.map((tile, x) => (
            <rect
              key={`${x}-${y}`}
              x={x * TILE_SIZE}
              y={y * TILE_SIZE}
              width={TILE_SIZE}
              height={TILE_SIZE}
              fill={TILE_COLORS[tile.type]}
              stroke="#1a1a18"
              strokeWidth={0.5}
            >
              {tile.type === "resource" && (
                <title>Resource: {tile.resources}</title>
              )}
            </rect>
          ))
        )}

        {/* Resource indicators */}
        {map.tiles.flatMap((row, y) =>
          row.map((tile, x) =>
            tile.type === "resource" && tile.resources > 0 ? (
              <circle
                key={`res-${x}-${y}`}
                cx={x * TILE_SIZE + TILE_SIZE / 2}
                cy={y * TILE_SIZE + TILE_SIZE / 2}
                r={Math.max(2, (tile.resources / 10) * (TILE_SIZE / 3))}
                fill="#6a9761"
                opacity={0.7}
              />
            ) : null
          )
        )}

        {/* Base */}
        <rect
          x={basePosition.x * TILE_SIZE + 2}
          y={basePosition.y * TILE_SIZE + 2}
          width={TILE_SIZE - 4}
          height={TILE_SIZE - 4}
          fill="none"
          stroke="#e8d5b0"
          strokeWidth={2}
          strokeDasharray="3,2"
        />
        <text
          x={basePosition.x * TILE_SIZE + TILE_SIZE / 2}
          y={basePosition.y * TILE_SIZE + TILE_SIZE / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#e8d5b0"
          fontSize={8}
          fontFamily="IBM Plex Mono"
          fontWeight={600}
        >
          B
        </text>

        {/* Agents */}
        {agents.map((agent) => {
          const cx = agent.position.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = agent.position.y * TILE_SIZE + TILE_SIZE / 2;
          const color = AGENT_COLORS[agent.type];
          const r = 5;

          return (
            <g key={agent.id}>
              {/* Agent shape */}
              {renderAgentShape(cx, cy, r, agent.status, color)}
              {/* Carrying indicator for gatherers */}
              {agent.type === "gatherer" && agent.carrying > 0 && (
                <circle
                  cx={cx + 5}
                  cy={cy - 5}
                  r={2}
                  fill="#e8d5b0"
                />
              )}
              <title>
                {agent.id} [{agent.status}]
                {agent.carrying > 0 ? ` carrying: ${agent.carrying}` : ""}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function renderAgentShape(
  cx: number,
  cy: number,
  r: number,
  status: string,
  color: string
) {
  switch (status) {
    case "moving":
    case "returning":
      // Triangle
      return (
        <polygon
          points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`}
          fill={color}
          opacity={0.9}
        />
      );
    case "gathering":
      // Diamond
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
          fill={color}
          opacity={0.9}
        />
      );
    case "defending":
      // Square
      return (
        <rect
          x={cx - r + 1}
          y={cy - r + 1}
          width={(r - 1) * 2}
          height={(r - 1) * 2}
          fill={color}
          opacity={0.9}
        />
      );
    default:
      // Circle (idle, scouting)
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.9} />;
  }
}
