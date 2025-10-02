# Multi-Agent Architecture Planning

## Overview

This document outlines the plan to refactor Bob from Claude-specific to supporting multiple LLM CLI agents. The system will maintain its current functionality while becoming agent-agnostic.

## Current State Analysis

### Working CLI Agents
Based on research, the following agents are available:
- **Claude CLI**: v1.0.128 (Claude Code) - Currently integrated
- **Codex CLI**: Full interactive and non-interactive modes available
- **Gemini CLI**: Interactive mode with sandbox support
- **Amazon Q**: `q chat` command for interactive sessions

### Excluded for Initial Implementation
- **Cursor Agent**: Not available in current environment
- **OpenCode**: Not available in current environment

## Architecture Goals

### 1. Agent Abstraction
- Create a unified interface for all LLM CLI agents
- Implement adapter pattern for each specific agent
- Maintain backward compatibility with existing Claude integration

### 2. UI Transformation
- Convert "Claude" tab to generic "Agent" tab
- Add agent selection during worktree creation
- Update system status dashboard for multi-agent support

### 3. Backend Refactoring
- Abstract agent management from Claude-specific implementation
- Create agent factory pattern for instance creation
- Update all services to work with generic agent interface

## Detailed Implementation Plan

### Phase 1: Core Architecture

#### 1.1 Agent Interface Design
```typescript
interface Agent {
  name: string;
  version: string;
  isAvailable(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  start(workingDirectory: string): Promise<AgentInstance>;
  getStatus(): Promise<AgentStatus>;
}

interface AgentInstance {
  id: string;
  agent: Agent;
  workingDirectory: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  sendCommand(command: string): Promise<string>;
  getTerminalStream(): WebSocketStream;
}
```

#### 1.2 Agent Factory
- Central factory for creating agent instances
- Configuration-driven agent selection
- Support for dynamic agent discovery

#### 1.3 Agent Adapters
Each agent will have a specific adapter implementing the common interface:

**Claude Adapter**:
- Wrap existing `claude` CLI functionality
- Interactive session management
- WebSocket terminal integration

**Codex Adapter**:
- Interactive mode: `codex [prompt]`
- Working directory support: `codex -C <dir>`
- Sandbox policies: `--sandbox workspace-write`
- Approval policies: `--ask-for-approval`

**Gemini Adapter**:
- Interactive mode: `gemini`
- Sandbox support: `--sandbox`
- Approval modes: `--approval-mode`
- Working directory navigation

**Amazon Q Adapter**:
- Interactive mode: `q chat`
- Session management for chat-based interactions
- Working directory context awareness

### Phase 2: Backend Services Update

#### 2.1 ClaudeService → AgentService
- Rename and generalize ClaudeService
- Update instance management for multiple agent types
- Maintain session isolation per worktree

#### 2.2 Database Schema Updates
```sql
-- Add agent_type column to instances
ALTER TABLE instances ADD COLUMN agent_type TEXT DEFAULT 'claude';
-- Add agent preferences to worktrees
ALTER TABLE worktrees ADD COLUMN preferred_agent TEXT DEFAULT 'claude';
```

#### 2.3 API Endpoint Updates
- `/api/instances` → support agent type filtering
- `/api/agents` → new endpoint for agent discovery
- `/api/system-status` → multi-agent status reporting

### Phase 3: Frontend Refactoring

#### 3.1 Component Updates
- `TerminalPanel` → `AgentPanel`
- Agent selection dropdown in worktree creation
- Agent status indicators in worktree list
- Multi-agent system status dashboard

#### 3.2 State Management
```typescript
interface AppState {
  availableAgents: Agent[];
  selectedAgent: string;
  instances: Record<string, AgentInstance>;
  worktrees: Array<Worktree & { agentType: string }>;
}
```

### Phase 4: Configuration & Preferences

#### 4.1 User Preferences
- Default agent selection
- Per-repository agent preferences
- Agent-specific configuration options

#### 4.2 Agent Configuration
```json
{
  "agents": {
    "claude": {
      "enabled": true,
      "defaultArgs": []
    },
    "codex": {
      "enabled": true,
      "defaultArgs": ["--sandbox", "workspace-write", "--ask-for-approval", "on-failure"]
    },
    "gemini": {
      "enabled": true,
      "defaultArgs": ["--sandbox", "--approval-mode", "auto_edit"]
    },
    "amazon-q": {
      "enabled": true,
      "defaultArgs": []
    }
  }
}
```

## Implementation Sequence

### Step 1: Agent Interface & Factory
1. Create base `Agent` interface and `AgentInstance` interface
2. Implement `AgentFactory` with registration system
3. Create abstract `BaseAgent` class with common functionality

### Step 2: Agent Adapters
1. **Claude Adapter**: Wrap existing implementation
2. **Codex Adapter**: Implement interactive session management
3. **Gemini Adapter**: Implement interactive session management
4. **Amazon Q Adapter**: Implement chat-based session management

### Step 3: Backend Migration
1. Refactor `ClaudeService` to `AgentService`
2. Update database schema and migrations
3. Update API endpoints for multi-agent support

### Step 4: Frontend Migration
1. Create agent selection UI components
2. Update worktree creation flow
3. Refactor terminal panel to be agent-agnostic
4. Update system status dashboard

### Step 5: Testing & Integration
1. Test each agent adapter individually
2. Test agent switching and session management
3. Test UI flows for all supported agents
4. Update documentation and help text

## Risk Mitigation

### Backward Compatibility
- Maintain existing Claude CLI integration during transition
- Default to Claude for existing worktrees
- Graceful fallback if preferred agent unavailable

### Agent Availability
- Check agent availability before offering in UI
- Handle agent installation/authentication status
- Provide helpful error messages and setup guidance

### Session Management
- Ensure proper cleanup when switching agents
- Handle agent crashes gracefully
- Maintain session isolation between worktrees

## Success Criteria

1. ✅ All supported agents can be selected during worktree creation
2. ✅ Agent-specific instances start and stop correctly
3. ✅ Terminal interaction works for all agents
4. ✅ System status shows health of all agents
5. ✅ Existing Claude workflows continue to work
6. ✅ UI clearly indicates which agent is active per worktree
7. ✅ Agent preferences are persisted and restored

## Future Enhancements

### Agent-Specific Features
- Expose agent-specific capabilities (sandbox modes, approval policies)
- Agent-specific configuration panels
- Integration with agent-specific authentication systems

### Advanced Workflows
- Agent comparison mode (run same prompt on multiple agents)
- Agent fallback chains (try Codex, fallback to Claude)
- Agent recommendations based on task type

### Extension Points
- Plugin system for custom agents
- Agent capability detection and UI adaptation
- Integration with agent-specific tools and features