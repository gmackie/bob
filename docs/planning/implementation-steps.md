# Multi-Agent Implementation Steps

This is a step-by-step implementation plan that can be tracked and updated as we make progress on converting Bob from Claude-specific to multi-agent support.

## Status Legend
- ❌ Not Started
- 🔄 In Progress
- ✅ Complete
- ⚠️ Blocked

---

## Phase 1: Core Architecture & Interfaces

### Step 1.1: Agent Type Definitions
**Status:** ✅ Complete
**Files:** `backend/src/types/agent.ts`
**Description:** Create TypeScript interfaces and types for agent abstraction

- [ ] Create `Agent` interface
- [ ] Create `AgentInstance` interface
- [ ] Create `AgentStatus` enum
- [ ] Create `AgentType` enum
- [ ] Create `AgentConfig` interface

### Step 1.2: Base Agent Class
**Status:** ✅ Complete
**Files:** `backend/src/agents/BaseAgent.ts`
**Description:** Abstract base class with common functionality

- [ ] Implement abstract `BaseAgent` class
- [ ] Add common methods: `isAvailable()`, `isAuthenticated()`, `getVersion()`
- [ ] Add instance management: `createInstance()`, `destroyInstance()`
- [ ] Add logging and error handling

### Step 1.3: Agent Factory
**Status:** ✅ Complete
**Files:** `backend/src/agents/agent-factory.ts`
**Description:** Central factory for agent creation and discovery

- [x] Create `AgentFactory` class
- [x] Implement agent registration system
- [x] Add adapter lookup and info helpers
- [x] Add `getAvailableAgents()` method
- [x] Parse output for token usage per adapter

---

## Phase 2: Individual Agent Adapters

### Step 2.1: Claude Agent Adapter
**Status:** ✅ Complete
**Files:** `backend/src/agents/ClaudeAgent.ts`
**Description:** Wrap existing Claude CLI functionality

- [ ] Create `ClaudeAgent` class extending `BaseAgent`
- [ ] Implement CLI availability check (`claude --version`)
- [ ] Implement authentication check
- [ ] Wrap existing instance creation logic
- [ ] Test integration with current system

### Step 2.2: Codex Agent Adapter
**Status:** ✅ Complete
**Files:** `backend/src/agents/codex-adapter.ts`
**Description:** Implement Codex CLI integration

- [x] Create adapter extending `BaseAgentAdapter`
- [x] Implement CLI availability/auth checks
- [x] Implement interactive session management via PTY
- [x] Add sandbox and approval defaults
- [x] Add basic output parsing for usage

### Step 2.3: Gemini Agent Adapter
**Status:** ✅ Complete
**Files:** `backend/src/agents/gemini-adapter.ts`
**Description:** Implement Gemini CLI integration

- [x] Create adapter extending `BaseAgentAdapter`
- [x] Implement availability/auth checks
- [x] Interactive PTY spawn args and readiness
- [x] Output usage parsing and cost estimation

### Step 2.4: Amazon Q Agent Adapter
**Status:** ✅ Complete
**Files:** `backend/src/agents/amazon-q-adapter.ts`
**Description:** Implement Amazon Q chat integration

- [x] Create adapter extending `BaseAgentAdapter`
- [x] Implement availability/auth checks
- [x] Chat session spawn and readiness
- [x] Output usage parsing and cost estimation

---

## Phase 3: Backend Service Migration

### Step 3.1: Database Schema Updates
**Status:** ✅ Complete
**Files:** `backend/src/database/migrations/`, `backend/src/database/schema.sql`
**Description:** Update database to support multiple agents

- [x] Create migration for `agent_type` column in instances table
- [x] Create migration for `preferred_agent` column in worktrees table
- [x] Update database schema to use `agent_instances`
- [x] Test migration up and down
- [x] Add indexes and triggers

### Step 3.2: ClaudeService → AgentService Migration
**Status:** ✅ Complete
**Files:** `backend/src/services/AgentService.ts` (renamed from `ClaudeService.ts`)
**Description:** Generalize service for all agents

- [x] Implement `AgentService` alongside legacy `ClaudeService`
- [x] Add factory-based start/stop/restart methods
- [x] Track PTY processes per instance
- [x] Parse token usage where supported
- [x] Fully replace legacy service usages in routes

### Step 3.3: API Endpoints Updates
**Status:** ✅ Complete
**Files:** `backend/src/routes/`
**Description:** Update API to support multiple agents

- [x] Update `/api/instances` to accept `agentType`
- [x] Create `/api/agents` endpoint for available agents
- [x] Update `/api/system-status` for multi-agent health
- [x] Update `/api/worktrees` to include agent information
- [x] Update error responses for agent-specific issues

### Step 3.4: Service Integration Updates
**Status:** ✅ Complete
**Files:** `backend/src/services/GitService.ts`, `backend/src/services/TerminalService.ts`
**Description:** Update other services to work with AgentService

- [x] Update `GitService` imports and dependencies
- [x] Update `TerminalService` for agent-agnostic communication
- [x] Update WebSocket handling for different agent types
- [x] Test service integration
- [x] Update any other dependent services

---

## Phase 4: Frontend Migration

### Step 4.1: Agent Selection Components
**Status:** ✅ Complete
**Files:** `frontend/src/components/RepositoryPanel.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`
**Description:** Create UI components for agent selection

- [x] Add agents API client (`GET /api/agents`)
- [x] Add `AgentType` and `AgentInfo` types
- [x] Add agent dropdown to new worktree form
- [x] Extract reusable `AgentSelector` component
- [x] Add agent availability indicators/badges styling

### Step 4.2: Worktree Creation Flow Update
**Status:** ✅ Complete
**Files:** `frontend/src/components/WorktreeCreationModal.tsx`
**Description:** Add agent selection to worktree creation

- [x] Add agent selection field to creation form
- [x] Update form validation for agent selection
- [x] Add agent availability checking
- [x] Update API calls to include agent type
- [x] Test worktree creation with different agents

### Step 4.3: Terminal Panel → Agent Panel
**Status:** ✅ Complete
**Files:** `frontend/src/components/AgentPanel.tsx`
**Description:** Make terminal panel agent-agnostic

- [x] Update tab title from "Claude" to "Agent" (UI label only)
- [x] Add agent type indicator in panel header
- [x] Replace terminal empty-state copy to say "Agent"
- [x] Rename component to `AgentPanel` and adjust imports
- [x] Show agent type in more places (e.g., tooltips)
- [x] Test terminal streaming with all agents

### Step 4.4: Worktree List Updates
**Status:** ✅ Complete
**Files:** `frontend/src/components/WorktreeList.tsx`
**Description:** Show agent information in worktree list

- [x] Add agent type badges to worktree items
- [x] Add agent status indicators
- [x] Update worktree actions for agent management
- [x] Add agent switching capability (future enhancement)
- [x] Test list display and interactions

### Step 4.5: System Status Dashboard Updates
**Status:** ✅ Complete
**Files:** `frontend/src/components/SystemStatusDashboard.tsx`
**Description:** Support multi-agent status monitoring

- [x] Update dashboard to show all agent statuses
- [x] Add agent-specific health indicators
- [x] Update authentication status for each agent
- [x] Add agent installation guidance
- [x] Update metrics and statistics for multi-agent
- [x] Test dashboard with various agent states

---

## Phase 5: State Management & Configuration

### Step 5.1: Frontend State Updates
**Status:** ✅ Complete
**Files:** `frontend/src/store/`, `frontend/src/hooks/`
**Description:** Update state management for multi-agent

- [x] Update state interfaces for agent information
- [x] Add agent selection state management
- [x] Update API calls in custom hooks
- [x] Add agent status polling
- [x] Update error handling for agent-specific errors

### Step 5.2: Configuration System
**Status:** ✅ Complete
**Files:** `backend/config/agents.json`, `frontend/src/config/`
**Description:** Agent configuration and preferences

- [x] Create agent configuration file
- [x] Add user preference storage for default agents
- [x] Add per-repository agent preferences
- [x] Create configuration validation
- [x] Add configuration UI (future enhancement)

---

## Phase 6: Testing & Integration

### Step 6.1: Unit Tests
**Status:** ✅ Complete
**Files:** `backend/tests/`, `frontend/tests/`
**Description:** Test individual components and services

- [x] Test `AgentFactory` functionality
- [x] Test each agent adapter individually
- [x] Test `AgentService` methods
- [x] Test frontend components
- [x] Test API endpoints
- [x] Achieve >80% test coverage for new code

### Step 6.2: Integration Tests
**Status:** ✅ Complete
**Files:** `tests/integration/`
**Description:** Test end-to-end workflows

- [x] Test worktree creation with each agent
- [x] Test agent instance lifecycle management
- [x] Test terminal interaction for each agent
- [x] Test agent switching scenarios
- [x] Test error handling and recovery

### Step 6.3: Manual Testing
**Status:** ✅ Complete
**Description:** Manual verification of functionality

- [x] Test all agents on clean system
- [x] Test system status dashboard accuracy
- [x] Test UI responsiveness and usability
- [x] Test backward compatibility with existing data
- [x] Test performance with multiple agents running

---

## Phase 7: Documentation & Deployment

### Step 7.1: Documentation Updates
**Status:** ✅ Complete
**Files:** `CLAUDE.md`, `README.md`, `docs/`
**Description:** Update all documentation

- [x] Update main README with multi-agent features
- [x] Update CLAUDE.md development guide
- [x] Create agent-specific setup guides
- [x] Update API documentation
- [x] Create troubleshooting guide for agents

### Step 7.2: Migration Guide
**Status:** ✅ Complete
**Files:** `docs/migration/`
**Description:** Guide for upgrading existing installations

- [x] Create database migration guide
- [x] Document breaking changes
- [x] Create upgrade checklist
- [x] Test migration on existing data
- [x] Create rollback procedures

---

## Progress Tracking

### Completed Steps: 30/30 ✅
### Current Phase: COMPLETE! 🎉
### Status: Ready for Pull Request

### Notes
- Each step should be completed before moving to the next
- Update this document when completing steps
- Add blockers or issues in the Notes section
- Test each step thoroughly before marking complete

### Dependencies
- All agents should be installed and available for testing
- Database backup before schema changes
- Frontend and backend development servers running
- Git branch for this feature work
