import React, { useMemo, useState } from "react";
import type { Agent, AgentAction, Doctrine, EpisodeEventType, TickDebrief } from "@doctrine/shared";

interface TickDebriefPanelProps {
  debrief: TickDebrief | null;
  agents: Agent[];
  doctrine: Doctrine | null;
}

const ACTION_ICONS: Record<string, string> = {
  move: ">",
  "move-intel": "»",
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
};

const EVENT_COLORS: Record<EpisodeEventType, string> = {
  "resource-found": "var(--color-success)",
  "resource-depleted": "var(--text-muted)",
  "task-completed": "var(--color-info)",
  "threat-spotted": "var(--color-warning)",
  "damage-taken": "var(--color-error)",
};

export function TickDebriefPanel({ debrief, agents, doctrine }: TickDebriefPanelProps) {
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

  function getMaxEpisodes(agent: Agent): number {
    if (!doctrine) return 10;
    if (agent.type === "gatherer") return doctrine.gatherer.memory.maxEpisodes;
    if (agent.type === "scout") return doctrine.scout.memory.maxEpisodes;
    if (agent.type === "defender") return doctrine.defender.memory.maxEpisodes;
    return 10;
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
      {debrief.notices && debrief.notices.length > 0 && (
        <div className="debrief-notices">
          {debrief.notices.map((notice, i) => (
            <div key={i} className={`debrief-notice ${notice.startsWith("FALLEN") ? "debrief-notice-fallen" : ""}`}>
              ! {notice}
            </div>
          ))}
        </div>
      )}
      <div className="debrief-actions">
        {debrief.actions.map((action, i) => {
          const agent = agentById.get(action.agentId);
          const isExpanded = expandedAgentId === action.agentId;
          return (
            <React.Fragment key={i}>
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
      className={`action-row action-${action.action}${isStale ? " action-stale" : ""}${isExpanded ? " action-row-expanded" : ""}`}
      onClick={onClick}
      aria-expanded={isExpanded}
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

function AgentMemoryPanel({ agent, maxEpisodes, currentTick }: { agent: Agent; maxEpisodes: number; currentTick: number }) {
  const memLoad = maxEpisodes > 0 ? Math.min(1, agent.episodes.length / maxEpisodes) : 0;
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
        <span className="memory-bar-count">{agent.episodes.length}/{maxEpisodes === 0 ? "∞" : maxEpisodes}</span>
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
            <div key={i} className="memory-episode">
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
