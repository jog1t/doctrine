import React from "react";
import type { TickDebrief, AgentAction } from "@doctrine/shared";

interface TickDebriefPanelProps {
  debrief: TickDebrief | null;
}

const ACTION_ICONS: Record<string, string> = {
  move: ">",
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

export function TickDebriefPanel({ debrief }: TickDebriefPanelProps) {
  if (!debrief) {
    return (
      <div className="debrief-panel">
        <h2>DEBRIEF</h2>
        <p className="debrief-empty">No ticks executed yet. Press TICK or START to begin.</p>
      </div>
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
      <div className="debrief-actions">
        {debrief.actions.map((action, i) => (
          <ActionRow key={i} action={action} />
        ))}
      </div>
    </div>
  );
}

function ActionRow({ action }: { action: AgentAction }) {
  const icon = ACTION_ICONS[action.action] || "?";
  const typeLabel = AGENT_TYPE_LABELS[action.agentType] || action.agentType;

  return (
    <div className={`action-row action-${action.action}`}>
      <span className="action-icon">{icon}</span>
      <span className={`action-type type-${action.agentType}`}>{typeLabel}</span>
      <span className="action-id">{action.agentId}</span>
      <span className="action-desc">{action.reason}</span>
    </div>
  );
}
