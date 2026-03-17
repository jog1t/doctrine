import React from "react";
import type { Agent, Doctrine, GameMap, Position, Threat, Tower } from "@doctrine/shared";

interface MapViewProps {
  map: GameMap;
  agents: Agent[];
  basePosition: Position;
  threats: Threat[];
  towers: Tower[];
  doctrine: Doctrine;
  previousDoctrine: Doctrine | null;
}

const TILE_SIZE = 22;

const TILE_COLORS: Record<string, string> = {
  empty: "#2a2a28",
  resource: "#3d5c38",
  obstacle: "#141412",
};

const AGENT_COLORS: Record<string, string> = {
  gatherer: "#c4a35a",
  scout: "#5a8fc4",
  defender: "#c45a5a",
};

function memoryLoad(agent: Agent, doctrine: Doctrine, previousDoctrine: Doctrine | null): number {
  // Resolve the doctrine this agent is actually running on the server
  const agentDoctrine =
    agent.deployedDoctrineVersion === doctrine.version ? doctrine :
    agent.deployedDoctrineVersion === previousDoctrine?.version ? previousDoctrine :
    null; // version too old — not available on client; show neutral ring

  if (!agentDoctrine) return 0.3;

  let maxEpisodes: number;
  if (agent.type === "gatherer") maxEpisodes = agentDoctrine.gatherer.memory.maxEpisodes;
  else if (agent.type === "scout") maxEpisodes = agentDoctrine.scout.memory.maxEpisodes;
  else if (agent.type === "defender") maxEpisodes = agentDoctrine.defender.memory.maxEpisodes;
  else maxEpisodes = 10;

  // Unlimited (maxEpisodes=0): scale by a fixed cap so the ring remains informative
  if (maxEpisodes === 0) return agent.episodes.length > 0 ? Math.min(1, agent.episodes.length / 50) : 0;
  return Math.min(1, agent.episodes.length / maxEpisodes);
}

export function MapView({ map, agents, basePosition, threats, towers, doctrine, previousDoctrine }: MapViewProps) {
  if (!map) return null;

  const width = map.width * TILE_SIZE;
  const height = map.height * TILE_SIZE;

  return (
    <div className="map-container">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="map-svg">
        <defs>
          {/* Hatch pattern for obstacles */}
          <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="#252520" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Tiles */}
        {map.tiles.map((row, y) =>
          row.map((tile, x) => (
            <g key={`${x}-${y}`}>
              <rect
                x={x * TILE_SIZE}
                y={y * TILE_SIZE}
                width={TILE_SIZE}
                height={TILE_SIZE}
                fill={TILE_COLORS[tile.type]}
                stroke="#1a1a18"
                strokeWidth={0.5}
              />
              {tile.type === "obstacle" && (
                <rect
                  x={x * TILE_SIZE}
                  y={y * TILE_SIZE}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  fill="url(#hatch)"
                  stroke="#1a1a18"
                  strokeWidth={0.5}
                />
              )}
              {tile.type === "resource" && <title>Resource: {tile.resources}</title>}
            </g>
          )),
        )}

        {/* Resource indicators */}
        {map.tiles.flatMap((row, y) =>
          row.map((tile, x) => {
            if (tile.type !== "resource" || tile.resources <= 0) return null;
            const frac = tile.resources / 10;
            const r = Math.max(2, frac * (TILE_SIZE / 3));
            return (
              <circle
                key={`res-${x}-${y}`}
                cx={x * TILE_SIZE + TILE_SIZE / 2}
                cy={y * TILE_SIZE + TILE_SIZE / 2}
                r={r}
                fill="#6a9761"
                opacity={0.4 + frac * 0.5}
              />
            );
          }),
        )}

        {/* Tower broadcast radius */}
        {towers.map((tower) => (
          <circle
            key={`tower-range-${tower.id}`}
            cx={tower.position.x * TILE_SIZE + TILE_SIZE / 2}
            cy={tower.position.y * TILE_SIZE + TILE_SIZE / 2}
            r={tower.broadcastRadius * TILE_SIZE}
            fill="none"
            stroke="#e8d5b0"
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

        {/* Towers */}
        {towers.map((tower) => (
          <g key={tower.id}>
            <rect
              x={tower.position.x * TILE_SIZE + 4}
              y={tower.position.y * TILE_SIZE + 4}
              width={TILE_SIZE - 8}
              height={TILE_SIZE - 8}
              fill="#3a3a30"
              stroke="#e8d5b0"
              strokeWidth={1.5}
            />
            <text
              x={tower.position.x * TILE_SIZE + TILE_SIZE / 2}
              y={tower.position.y * TILE_SIZE + TILE_SIZE / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#e8d5b0"
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
                stroke="#c43a3a"
                strokeWidth={2}
              />
              <line
                x1={cx + r}
                y1={cy - r}
                x2={cx - r}
                y2={cy + r}
                stroke="#c43a3a"
                strokeWidth={2}
              />
              <title>
                {threat.id} — HP {threat.hp}/{threat.maxHp}
              </title>
            </g>
          );
        })}

        {/* Agents — offset stacked agents so all are visible */}
        {(() => {
          // Count how many agents share each tile and assign a slot index
          const tileCounts = new Map<string, number>();
          const tileSlot = new Map<string, number>();
          for (const agent of agents) {
            const key = `${agent.position.x},${agent.position.y}`;
            const count = tileCounts.get(key) ?? 0;
            tileSlot.set(agent.id, count);
            tileCounts.set(key, count + 1);
          }

          // Offsets for up to 4 agents on the same tile (compass directions)
          const OFFSETS = [
            { dx: 0, dy: 0 },
            { dx: 5, dy: -5 },
            { dx: -5, dy: 5 },
            { dx: 5, dy: 5 },
          ];

          return agents.map((agent) => {
          const slot = tileSlot.get(agent.id) ?? 0;
          const tileTotal = tileCounts.get(`${agent.position.x},${agent.position.y}`) ?? 1;
          const offset = tileTotal > 1 ? (OFFSETS[slot % OFFSETS.length] ?? OFFSETS[0]) : { dx: 0, dy: 0 };
          const cx = agent.position.x * TILE_SIZE + TILE_SIZE / 2 + offset.dx;
          const cy = agent.position.y * TILE_SIZE + TILE_SIZE / 2 + offset.dy;
          const color = AGENT_COLORS[agent.type];
          const r = 5;
          const load = memoryLoad(agent, doctrine, previousDoctrine);

          return (
            <g key={agent.id}>
              {/* Memory load ring — grows brighter as episodes accumulate */}
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
              {/* Stale doctrine indicator (running old version) */}
              {agent.deployedDoctrineVersion < (doctrine?.version ?? 1) && (
                <circle
                  cx={cx + 6}
                  cy={cy - 6}
                  r={2.5}
                  fill="#e8a030"
                  opacity={0.9}
                />
              )}
              {/* Agent shape */}
              {renderAgentShape(cx, cy, r, agent.status, color)}
              {/* Carrying amount for gatherers */}
              {agent.type === "gatherer" && agent.carrying > 0 && (
                <text
                  x={cx + r + 1}
                  y={cy - r}
                  fontSize={6}
                  fontFamily="IBM Plex Mono"
                  fontWeight={600}
                  fill="#e8d5b0"
                  textAnchor="start"
                  dominantBaseline="auto"
                >
                  {agent.carrying}
                </text>
              )}
              {/* HP bar — only shown when damaged */}
              {agent.hp < agent.maxHp && (
                <g>
                  <rect
                    x={cx - r}
                    y={cy + r + 2}
                    width={r * 2}
                    height={2}
                    fill="#3a3a36"
                    rx={1}
                  />
                  <rect
                    x={cx - r}
                    y={cy + r + 2}
                    width={r * 2 * (agent.hp / agent.maxHp)}
                    height={2}
                    fill={agent.hp / agent.maxHp > 0.5 ? "#6a9761" : "#c45a5a"}
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
        })()}
      </svg>
    </div>
  );
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
