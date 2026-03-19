import React from "react";
import { resolveDoctrineMaxEpisodes } from "@doctrine/shared";
import type {
  Agent,
  Doctrine,
  DoctrineRenderSummary,
  GameMap,
  Position,
  Threat,
  ThreatSighting,
  Tower,
} from "@doctrine/shared";

interface MapViewProps {
  map: GameMap;
  agents: Agent[];
  basePosition: Position;
  currentTick: number;
  threats: Threat[];
  threatSightings: ThreatSighting[];
  towers: Tower[];
  doctrine: Doctrine;
  doctrineHistory: DoctrineRenderSummary[];
}

const TILE_SIZE = 22;

const TILE_COLORS: Record<string, string> = {
  empty: "var(--map-tile-empty)",
  resource: "var(--map-tile-resource)",
  obstacle: "var(--map-tile-obstacle)",
};

const AGENT_COLORS: Record<string, string> = {
  gatherer: "var(--color-gatherer)",
  scout: "var(--color-scout)",
  defender: "var(--color-defender)",
};

const STACKED_AGENT_OFFSETS = [
  { dx: 0, dy: 0 },
  { dx: 5, dy: -5 },
  { dx: -5, dy: 5 },
  { dx: 5, dy: 5 },
];

function memoryLoad(
  agent: Agent,
  doctrine: Doctrine,
  doctrineHistory: DoctrineRenderSummary[],
): number {
  const maxEpisodes = resolveDoctrineMaxEpisodes(
    doctrine,
    doctrineHistory,
    agent.type,
    agent.deployedDoctrineVersion,
  );

  if (maxEpisodes === null) return 0.3;

  // Unlimited (maxEpisodes=0): scale by a fixed cap so the ring remains informative
  if (maxEpisodes === 0) return agent.episodes.length > 0 ? Math.min(1, agent.episodes.length / 50) : 0;
  return Math.min(1, agent.episodes.length / maxEpisodes);
}

export function MapView({
  map,
  agents,
  basePosition,
  currentTick,
  threats,
  threatSightings,
  towers,
  doctrine,
  doctrineHistory,
}: MapViewProps) {
  if (!map) return null;

  const width = map.width * TILE_SIZE;
  const height = map.height * TILE_SIZE;
  const tileElements = [];
  const resourceElements = [];

  for (let y = 0; y < map.tiles.length; y++) {
    const row = map.tiles[y];
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      tileElements.push(
        <g key={`tile-${x}-${y}`}>
          <rect
            x={x * TILE_SIZE}
            y={y * TILE_SIZE}
            width={TILE_SIZE}
            height={TILE_SIZE}
            fill={TILE_COLORS[tile.type]}
            stroke="var(--map-grid-stroke)"
            strokeWidth={0.5}
          />
          {tile.type === "obstacle" && (
            <rect
              x={x * TILE_SIZE}
              y={y * TILE_SIZE}
              width={TILE_SIZE}
              height={TILE_SIZE}
              fill="url(#hatch)"
              stroke="var(--map-grid-stroke)"
              strokeWidth={0.5}
            />
          )}
          {tile.type === "resource" && <title>Resource: {tile.resources}</title>}
        </g>,
      );

      if (tile.type !== "resource" || tile.resources <= 0) continue;

      const frac = tile.resources / 10;
      const r = Math.max(2, frac * (TILE_SIZE / 3));
      resourceElements.push(
        <circle
          key={`res-${x}-${y}`}
          cx={x * TILE_SIZE + TILE_SIZE / 2}
          cy={y * TILE_SIZE + TILE_SIZE / 2}
          r={r}
          fill="var(--color-success)"
          opacity={0.4 + frac * 0.5}
        />,
      );
    }
  }

  return (
    <div className="map-container">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="map-svg">
        <defs>
          {/* Hatch pattern for obstacles */}
          <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <title>Obstacle hatch pattern</title>
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--map-hatch-stroke)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Tiles */}
        {tileElements}

        {/* Resource indicators */}
        {resourceElements}

        {/* Tower broadcast radius */}
        {towers.map((tower) => (
          <circle
            key={`tower-range-${tower.id}`}
            cx={tower.position.x * TILE_SIZE + TILE_SIZE / 2}
            cy={tower.position.y * TILE_SIZE + TILE_SIZE / 2}
            r={tower.broadcastRadius * TILE_SIZE}
            fill="none"
            stroke="var(--map-base-stroke)"
            strokeWidth={0.5}
            strokeDasharray="4,4"
            opacity={0.2}
          />
        ))}

        {/* Base */}
        <rect
          x={basePosition.x * TILE_SIZE + 2}
          y={basePosition.y * TILE_SIZE + 2}
          width={TILE_SIZE - 4}
          height={TILE_SIZE - 4}
          fill="none"
          stroke="var(--map-base-stroke)"
          strokeWidth={2}
          strokeDasharray="3,2"
        />
        <text
          x={basePosition.x * TILE_SIZE + TILE_SIZE / 2}
          y={basePosition.y * TILE_SIZE + TILE_SIZE / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--map-base-stroke)"
          fontSize={8}
          fontFamily="IBM Plex Mono"
          fontWeight={600}
        >
          B
        </text>

        {/* Towers */}
        {towers.map((tower) => (
          <g key={tower.id}>
            <rect
              x={tower.position.x * TILE_SIZE + 4}
              y={tower.position.y * TILE_SIZE + 4}
              width={TILE_SIZE - 8}
              height={TILE_SIZE - 8}
              fill="var(--map-tower-fill)"
              stroke="var(--map-base-stroke)"
              strokeWidth={1.5}
            />
            <text
              x={tower.position.x * TILE_SIZE + TILE_SIZE / 2}
              y={tower.position.y * TILE_SIZE + TILE_SIZE / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--map-base-stroke)"
              fontSize={6}
              fontFamily="IBM Plex Mono"
              fontWeight={600}
            >
              T
            </text>
            <title>Tower — broadcasts doctrine within radius {tower.broadcastRadius}</title>
          </g>
        ))}

        {/* Threats */}
        {threats.map((threat) => {
          const cx = threat.position.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = threat.position.y * TILE_SIZE + TILE_SIZE / 2;
          const r = 5;
          return (
            <g key={threat.id}>
              {/* X shape */}
              <line
                x1={cx - r}
                y1={cy - r}
                x2={cx + r}
                y2={cy + r}
                stroke="var(--color-error)"
                strokeWidth={2}
              />
              <line
                x1={cx + r}
                y1={cy - r}
                x2={cx - r}
                y2={cy + r}
                stroke="var(--color-error)"
                strokeWidth={2}
              />
              <title>
                {threat.id} — HP {threat.hp}/{threat.maxHp}
              </title>
            </g>
          );
        })}

        {/* Last-known threat sightings */}
        {threatSightings.map((sighting) => {
          const age = Math.max(0, currentTick - sighting.lastSeenTick);
          const opacity = Math.max(0.2, 0.75 - age * 0.03);
          const cx = sighting.position.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = sighting.position.y * TILE_SIZE + TILE_SIZE / 2;
          const radius = 7 + Math.min(age, 6);

          return (
            <g key={`sighting-${sighting.threatId}`} opacity={opacity}>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="var(--color-intel)"
                strokeWidth={1.5}
                strokeDasharray="3,3"
              />
              <circle
                cx={cx}
                cy={cy}
                r={2}
                fill="var(--color-intel)"
              />
              <title>
                Intel: {sighting.threatId} last seen at ({sighting.position.x}, {sighting.position.y}) on tick {sighting.lastSeenTick}
              </title>
            </g>
          );
        })}

        {/* Agents — offset stacked agents so all are visible */}
        <AgentMarkers
          agents={agents}
          doctrine={doctrine}
          doctrineHistory={doctrineHistory}
        />
      </svg>

      {threatSightings.length > 0 && (
        <div className="map-legend">
          <div className="map-legend-title">THREAT INTEL</div>
          <div className="map-legend-item">
            <span className="map-legend-swatch map-legend-swatch-threat" />
            <span>hostile contact</span>
          </div>
          <div className="map-legend-item">
            <span className="map-legend-swatch map-legend-swatch-sighting" />
            <span>last-known hostile position</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentMarkers({
  agents,
  doctrine,
  doctrineHistory,
}: {
  agents: Agent[];
  doctrine: Doctrine;
  doctrineHistory: DoctrineRenderSummary[];
}) {
  const tileCounts = new Map<string, number>();
  const tileSlot = new Map<string, number>();

  for (const agent of agents) {
    const key = `${agent.position.x},${agent.position.y}`;
    const count = tileCounts.get(key) ?? 0;
    tileSlot.set(agent.id, count);
    tileCounts.set(key, count + 1);
  }

  return agents.map((agent) => {
    const slot = tileSlot.get(agent.id) ?? 0;
    const tileTotal = tileCounts.get(`${agent.position.x},${agent.position.y}`) ?? 1;
    const offset = tileTotal > 1 ? (STACKED_AGENT_OFFSETS[slot % STACKED_AGENT_OFFSETS.length] ?? STACKED_AGENT_OFFSETS[0]) : { dx: 0, dy: 0 };
    const cx = agent.position.x * TILE_SIZE + TILE_SIZE / 2 + offset.dx;
    const cy = agent.position.y * TILE_SIZE + TILE_SIZE / 2 + offset.dy;
    const color = AGENT_COLORS[agent.type];
    const r = 5;
    const load = memoryLoad(agent, doctrine, doctrineHistory);

    return (
      <g key={agent.id}>
        {load > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r + 3}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={load * 0.7}
          />
        )}
        {agent.deployedDoctrineVersion < doctrine.version && (
          <circle
            cx={cx + 6}
            cy={cy - 6}
            r={2.5}
            fill="var(--color-doctrine-stale)"
            opacity={0.9}
          />
        )}
        {renderAgentShape(cx, cy, r, agent.status, color)}
        {agent.type === "gatherer" && agent.carrying > 0 && (
          <text
            x={cx + r + 1}
            y={cy - r}
            fontSize={6}
            fontFamily="IBM Plex Mono"
            fontWeight={600}
            fill="var(--map-base-stroke)"
            textAnchor="start"
            dominantBaseline="auto"
          >
            {agent.carrying}
          </text>
        )}
        {agent.hp < agent.maxHp && (
          <g>
            <rect
              x={cx - r}
              y={cy + r + 2}
              width={r * 2}
              height={2}
              fill="var(--map-health-bg)"
              rx={1}
            />
            <rect
              x={cx - r}
              y={cy + r + 2}
              width={r * 2 * (agent.hp / agent.maxHp)}
              height={2}
              fill={agent.hp / agent.maxHp > 0.5 ? "var(--color-success)" : "var(--color-defender)"}
              rx={1}
            />
          </g>
        )}
        <title>
          {agent.id} [{agent.status}] v{agent.deployedDoctrineVersion}
          {agent.carrying > 0 ? ` carrying: ${agent.carrying}` : ""}
          {` memory: ${agent.episodes.length} episodes`}
        </title>
      </g>
    );
  });
}

function renderAgentShape(cx: number, cy: number, r: number, status: string, color: string) {
  switch (status) {
    case "moving":
    case "returning":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`}
          fill={color}
          opacity={0.9}
        />
      );
    case "gathering":
    case "depositing":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
          fill={color}
          opacity={0.9}
        />
      );
    case "defending":
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
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.9} />;
  }
}
