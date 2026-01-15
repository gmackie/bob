import React from 'react';
import { AgentType, AgentInfo } from '../types';

interface AgentSelectorProps {
  agents: AgentInfo[];
  value: AgentType | undefined;
  onChange: (agentType: AgentType | undefined) => void;
  onAuthenticate?: (agentType: AgentType) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties & { select?: React.CSSProperties };
  showBadges?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  value,
  onChange,
  onAuthenticate,
  disabled = false,
  className = 'input',
  style,
  showBadges = false
}) => {
  const getAgentBadgeColor = (agent: AgentInfo) => {
    if (!agent.isAvailable) return '#6b7280'; // gray
    if (agent.isAuthenticated === false) return '#f59e0b'; // amber
    return '#10b981'; // green
  };

  const getAgentStatusIcon = (agent: AgentInfo) => {
    if (!agent.isAvailable) return '❌';
    if (agent.isAuthenticated === false) return '⚠️';
    return '✅';
  };

  const selectedAgent = agents.find(a => a.type === value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...style }}>
      <select
        value={value || ''}
        onChange={(e) => onChange((e.target.value || undefined) as AgentType | undefined)}
        className={className}
        disabled={disabled}
        style={{
          minWidth: '160px',
          fontSize: '12px',
          padding: '6px 8px',
          ...(style?.select || {})
        }}
        title="Select agent for this worktree"
      >
        {agents.length === 0 && <option value="">Default (Claude)</option>}
        {agents.map(agent => (
          <option
            key={agent.type}
            value={agent.type}
            disabled={!agent.isAvailable}
          >
            {agent.name} {agent.version ? `(${agent.version})` : ''}
            {!agent.isAvailable ? ' - unavailable' : ''}
            {agent.isAuthenticated === false ? ' - not authenticated' : ''}
          </option>
        ))}
      </select>

      {onAuthenticate && selectedAgent?.isAuthenticated === false && (
        <button
          onClick={() => onAuthenticate(selectedAgent.type)}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            backgroundColor: '#f59e0b',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
          title={`Authenticate ${selectedAgent.name}`}
        >
          Authenticate
        </button>
      )}

      {showBadges && value && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          {agents
            .filter(a => a.type === value)
            .map(agent => (
              <span
                key={agent.type}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 500,
                  background: `${getAgentBadgeColor(agent)}20`,
                  color: getAgentBadgeColor(agent),
                  border: `1px solid ${getAgentBadgeColor(agent)}40`
                }}
                title={`${agent.name}: ${agent.isAvailable ? 'Available' : 'Not Available'}${agent.isAuthenticated === false ? ' (Not Authenticated)' : ''}`}
              >
                {getAgentStatusIcon(agent)}
                {agent.name}
              </span>
            ))}
        </div>
      )}
    </div>
  );
};

export const AgentBadge: React.FC<{
  agentType: AgentType;
  agents: AgentInfo[];
  compact?: boolean;
}> = ({ agentType, agents, compact = false }) => {
  const agent = agents.find(a => a.type === agentType);
  if (!agent) {
    return (
      <span style={{
        padding: '2px 6px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 500,
        background: '#6b728020',
        color: '#6b7280',
        border: '1px solid #6b728040'
      }}>
        {compact ? agentType.slice(0, 3).toUpperCase() : agentType}
      </span>
    );
  }

  const getColor = () => {
    if (!agent.isAvailable) return '#6b7280';
    if (agent.isAuthenticated === false) return '#f59e0b';
    return '#10b981';
  };

  const getIcon = () => {
    if (!agent.isAvailable) return '❌';
    if (agent.isAuthenticated === false) return '⚠️';
    return '✅';
  };

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 6px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 500,
      background: `${getColor()}20`,
      color: getColor(),
      border: `1px solid ${getColor()}40`
    }}
    title={`${agent.name}: ${agent.isAvailable ? 'Available' : 'Not Available'}${agent.isAuthenticated === false ? ' (Not Authenticated)' : ''}`}
    >
      {!compact && getIcon()}
      {compact ? agent.name.slice(0, 3).toUpperCase() : agent.name}
    </span>
  );
};