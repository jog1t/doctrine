import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { resolveDoctrineMaxEpisodes } from "@doctrine/shared";
import type {
  Agent,
  AgentAction,
  Doctrine,
  DoctrineRenderSummary,
  EpisodeEventType,
  ThreatSighting,
  TickDebrief,
} from "@doctrine/shared";

interface TickDebriefPanelProps {
  debrief: TickDebrief | null;
  agents: Agent[];
  doctrine: Doctrine | null;
  doctrineHistory: DoctrineRenderSummary[];
  threatSightings: ThreatSighting[];
}

const ACTION_ICONS: Record<string, string> = {
  move: ">",
  "move-intel": "»",
  attack: "x",
  gather: "+",
  deposit: "$",
  observe: "?",
  guard: "#",
  idle: "-",
};

const AGENT_TYPE_LABELS: Record<string, string> = {
  gatherer: "GAT",
  scout: "SCT",
  defender: "DEF",
};

const EVENT_ICONS: Record<EpisodeEventType, string> = {
  "resource-found": "+",
  "resource-depleted": "∅",
  "task-completed": "✓",
  "threat-spotted": "!",
  "damage-taken": "✕",
  "threat-neutralized": "x",
};

const EVENT_COLORS: Record<EpisodeEventType, string> = {
  "resource-found": "var(--color-success)",
  "resource-depleted": "var(--text-muted)",
  "task-completed": "var(--color-info)",
  "threat-spotted": "var(--color-warning)",
  "damage-taken": "var(--color-error)",
  "threat-neutralized": "var(--color-success)",
};

export function TickDebriefPanel({
  debrief,
  agents,
  doctrine,
  doctrineHistory,
  threatSightings,
}: TickDebriefPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  if (!debrief) {
    return (
      <div className="debrief-panel">
        <h2>DEBRIEF</h2>
        <p className="debrief-empty">No ticks executed yet. Press TICK or START to begin.</p>
      </div>
    );
  }

  const currentVersion = doctrine?.version ?? 1;
  const staleAgents = agents.filter((a) => a.deployedDoctrineVersion < currentVersion);
  const notices = debrief.notices ?? [];
  const threatDownNotices = notices.filter((notice) => notice.startsWith("THREAT DOWN:"));
  const threatDownIds = threatDownNotices.map((notice) =>
    notice.replace(/^THREAT DOWN:\s*/, "").replace(/ neutralized by defenders$/, ""),
  );
  const otherNotices = notices.filter((notice) => !notice.startsWith("THREAT DOWN:"));

  function getMaxEpisodes(agent: Agent): number | null {
    if (!doctrine) return null;
    return resolveDoctrineMaxEpisodes(
      doctrine,
      doctrineHistory,
      agent.type,
      agent.deployedDoctrineVersion,
    );
  }

  return (
    <div className="debrief-panel">
      <div className="debrief-header">
        <h2>DEBRIEF</h2>
        <span className="debrief-tick">Tick #{debrief.tick}</span>
      </div>
      {debrief.resourcesCollected > 0 && (
        <div className="debrief-collected">
          +{debrief.resourcesCollected} resources collected this tick
        </div>
      )}
      {staleAgents.length > 0 && (
        <div className="debrief-version-skew">
          ! VERSION SKEW: {staleAgents.map((a) => `${a.id} (v${a.deployedDoctrineVersion})`).join(", ")} running old doctrine
        </div>
      )}
      {threatDownIds.length > 0 && (
        <div className="debrief-threat-down">
          <div className="debrief-threat-down-label">THREAT DOWN</div>
          <div className="debrief-threat-down-summary">
            {threatDownIds.length} {threatDownIds.length === 1 ? "hostile neutralized" : "hostiles neutralized"} this tick
          </div>
          <div className="debrief-threat-down-list">
            {threatDownIds.map((threatId) => (
              <div key={threatId} className="debrief-threat-down-entry">
                <span className="debrief-threat-down-icon">x</span>
                <span className="debrief-threat-down-id">{threatId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {threatSightings.length > 0 && (
        <div className="debrief-threat-intel">
          <div className="debrief-threat-intel-label">THREAT INTEL</div>
          <div className="debrief-threat-intel-list">
            {threatSightings.map((sighting) => (
              <div key={sighting.threatId} className="debrief-threat-intel-entry">
                <span className="debrief-threat-intel-id">{sighting.threatId}</span>
                <span className="debrief-threat-intel-pos">({sighting.position.x}, {sighting.position.y})</span>
                <span className="debrief-threat-intel-tick">seen t{sighting.lastSeenTick}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {otherNotices.length > 0 && (
        <div className="debrief-notices">
          {otherNotices.map((notice, i) => (
            <div key={`${i}-${notice}`} className={`debrief-notice ${notice.startsWith("FALLEN") ? "debrief-notice-fallen" : ""}`}>
              ! {notice}
            </div>
          ))}
        </div>
      )}
      <div className="debrief-actions">
        {debrief.actions.map((action) => {
          const agent = agentById.get(action.agentId);
          const isExpanded = expandedAgentId === action.agentId;
          return (
            <React.Fragment key={action.agentId}>
              <ActionRow
                action={action}
                currentDoctrineVersion={currentVersion}
                hasMemory={!!agent && (agent.episodes.length > 0 || agent.workingMemory.currentTask !== null)}
                isExpanded={isExpanded}
                onClick={() => setExpandedAgentId(isExpanded ? null : action.agentId)}
              />
              {isExpanded && agent && (
                <AgentMemoryPanel agent={agent} maxEpisodes={getMaxEpisodes(agent)} currentTick={debrief.tick} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  currentDoctrineVersion,
  hasMemory,
  isExpanded,
  onClick,
}: {
  action: AgentAction;
  currentDoctrineVersion: number;
  hasMemory: boolean;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const icon = ACTION_ICONS[action.action] || "?";
  const typeLabel = AGENT_TYPE_LABELS[action.agentType] || action.agentType;
  const isStale = action.doctrineVersion < currentDoctrineVersion;

  return (
    <button
      type="button"
      className={clsx("action-row", `action-${action.action}`, {
        "action-stale": isStale,
        "action-row-expanded": hasMemory && isExpanded,
      })}
      onClick={hasMemory ? onClick : undefined}
      disabled={!hasMemory}
      aria-expanded={hasMemory ? isExpanded : undefined}
    >
      <span className="action-icon">{icon}</span>
      <span className={`action-type type-${action.agentType}`}>{typeLabel}</span>
      <span className="action-id">{action.agentId}</span>
      {isStale && (
        <span className="action-version" title="Running stale doctrine">
          v{action.doctrineVersion}
        </span>
      )}
      <span className="action-desc">{action.reason}</span>
      {hasMemory && (
        <span className="action-memory-toggle" title="View agent memory">
          {isExpanded ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

function AgentMemoryPanel({ agent, maxEpisodes, currentTick }: { agent: Agent; maxEpisodes: number | null; currentTick: number }) {
  // null = agent's doctrine version not available client-side (too old); show neutral ring
  // 0    = unlimited; scale against a fixed cap so the bar remains informative
  const memLoad = maxEpisodes === null
    ? 0.3
    : maxEpisodes > 0
      ? Math.min(1, agent.episodes.length / maxEpisodes)
      : Math.min(1, agent.episodes.length / 50);
  const wm = agent.workingMemory;
  const recentEpisodes = agent.episodes.slice(-8).reverse();

  return (
    <div className="agent-memory-panel">
      {/* Memory bar */}
      <div className="memory-bar-row">
        <span className="memory-bar-label">MEMORY</span>
        <div className="memory-bar-track">
          <div
            className="memory-bar-fill"
            style={{ width: `${memLoad * 100}%`, opacity: 0.4 + memLoad * 0.6 }}
          />
        </div>
        <span className="memory-bar-count">{agent.episodes.length}/{maxEpisodes === null ? "?" : maxEpisodes === 0 ? "∞" : maxEpisodes}</span>
      </div>

      {/* Working memory */}
      {wm.currentTask && (
        <div className="memory-working">
          <span className="memory-section-label">TASK</span>
          <span className="memory-working-task">{wm.currentTask}</span>
          {wm.taskTarget && (
            <span className="memory-working-target">→ ({wm.taskTarget.x}, {wm.taskTarget.y})</span>
          )}
          {wm.taskStartTick !== null && (
            <span className="memory-working-age">t{wm.taskStartTick} (+{currentTick - wm.taskStartTick})</span>
          )}
        </div>
      )}

      {/* Episode log */}
      {recentEpisodes.length > 0 ? (
        <div className="memory-episodes">
          <div className="memory-section-label">EPISODES</div>
          {recentEpisodes.map((ep, i) => (
            <div key={`${ep.tick}-${ep.eventType}-${i}`} className="memory-episode">
              <span className="memory-episode-icon" style={{ color: EVENT_COLORS[ep.eventType] }}>
                {EVENT_ICONS[ep.eventType]}
              </span>
              <span className="memory-episode-tick">t{ep.tick}</span>
              <span className="memory-episode-pos">({ep.position.x},{ep.position.y})</span>
              <span className="memory-episode-detail">{ep.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="memory-empty">No episodes recorded yet.</div>
      )}
    </div>
  );
}
