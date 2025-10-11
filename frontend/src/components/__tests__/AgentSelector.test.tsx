import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AgentSelector, AgentBadge } from '../AgentSelector';
import { AgentInfo, AgentType } from '../../types';

describe('AgentSelector', () => {
  const mockAgents: AgentInfo[] = [
    {
      type: 'claude' as AgentType,
      name: 'Claude',
      isAvailable: true,
      isAuthenticated: true,
      version: '1.0.0',
      statusMessage: 'Ready'
    },
    {
      type: 'codex' as AgentType,
      name: 'Codex',
      isAvailable: true,
      isAuthenticated: false,
      version: '2.0.0',
      statusMessage: 'Not authenticated'
    },
    {
      type: 'gemini' as AgentType,
      name: 'Gemini',
      isAvailable: false,
      isAuthenticated: undefined,
      version: undefined,
      statusMessage: 'Not installed'
    }
  ];

  it('renders all available agents', () => {
    const onChange = vi.fn();
    render(
      <AgentSelector
        agents={mockAgents}
        value={undefined}
        onChange={onChange}
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    // Open select to see options
    fireEvent.click(select);

    // Check that all agents are in the dropdown
    mockAgents.forEach(agent => {
      const option = screen.getByText(new RegExp(agent.name));
      expect(option).toBeInTheDocument();
    });
  });

  it('disables unavailable agents', () => {
    const onChange = vi.fn();
    render(
      <AgentSelector
        agents={mockAgents}
        value={undefined}
        onChange={onChange}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = select.querySelectorAll('option');

    // Gemini should be disabled (not available)
    const geminiOption = Array.from(options).find(opt =>
      opt.textContent?.includes('Gemini')
    ) as HTMLOptionElement;
    expect(geminiOption?.disabled).toBe(true);

    // Codex should be disabled (not authenticated)
    const codexOption = Array.from(options).find(opt =>
      opt.textContent?.includes('Codex')
    ) as HTMLOptionElement;
    expect(codexOption?.disabled).toBe(true);

    // Claude should be enabled
    const claudeOption = Array.from(options).find(opt =>
      opt.textContent?.includes('Claude')
    ) as HTMLOptionElement;
    expect(claudeOption?.disabled).toBe(false);
  });

  it('calls onChange when agent is selected', () => {
    const onChange = vi.fn();
    render(
      <AgentSelector
        agents={mockAgents}
        value={undefined}
        onChange={onChange}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'claude' } });

    expect(onChange).toHaveBeenCalledWith('claude');
  });

  it('shows badges when showBadges is true', () => {
    const onChange = vi.fn();
    render(
      <AgentSelector
        agents={mockAgents}
        value={'claude' as AgentType}
        onChange={onChange}
        showBadges={true}
      />
    );

    // Badge should be visible
    const badge = screen.getByText('Claude');
    expect(badge).toBeInTheDocument();

    // Badge should have correct status icon
    expect(screen.getByText('✅')).toBeInTheDocument();
  });
});

describe('AgentBadge', () => {
  const mockAgents: AgentInfo[] = [
    {
      type: 'claude' as AgentType,
      name: 'Claude',
      isAvailable: true,
      isAuthenticated: true,
      version: '1.0.0',
      statusMessage: 'Ready'
    },
    {
      type: 'codex' as AgentType,
      name: 'Codex',
      isAvailable: true,
      isAuthenticated: false,
      version: '2.0.0',
      statusMessage: 'Not authenticated'
    }
  ];

  it('renders agent badge with correct status', () => {
    render(
      <AgentBadge
        agentType={'claude' as AgentType}
        agents={mockAgents}
      />
    );

    const badge = screen.getByText(/Claude/);
    expect(badge).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('renders compact badge when compact is true', () => {
    render(
      <AgentBadge
        agentType={'claude' as AgentType}
        agents={mockAgents}
        compact={true}
      />
    );

    // In compact mode, should show abbreviated name
    const badge = screen.getByText('CLA');
    expect(badge).toBeInTheDocument();
  });

  it('shows warning icon for unauthenticated agents', () => {
    render(
      <AgentBadge
        agentType={'codex' as AgentType}
        agents={mockAgents}
      />
    );

    expect(screen.getByText('⚠️')).toBeInTheDocument();
  });

  it('handles unknown agent types gracefully', () => {
    render(
      <AgentBadge
        agentType={'unknown' as AgentType}
        agents={mockAgents}
      />
    );

    // Should show the agent type even if not in the list
    const badge = screen.getByText('unknown');
    expect(badge).toBeInTheDocument();
  });
});