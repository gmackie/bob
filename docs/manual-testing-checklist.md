# Manual Testing Checklist for Multi-Agent Support

## Pre-Test Setup
- [ ] Ensure at least one agent CLI is installed (Claude, Codex, Gemini, etc.)
- [ ] Authenticate with at least one agent
- [ ] Have a test repository ready
- [ ] Clear browser cache and local storage
- [ ] Start development servers: `npm run dev:clean`

## 1. Agent Discovery & Status
### System Status Dashboard
- [ ] Navigate to any worktree and click on "System Status" tab
- [ ] Verify all installed agents are displayed
- [ ] Verify correct status indicators (✅ Available, ⚠️ Not Authenticated, ❌ Not Available)
- [ ] Verify version numbers are shown for available agents
- [ ] Verify authentication guidance is shown for unauthenticated agents

### Agent List API
- [ ] Open Network tab in browser DevTools
- [ ] Refresh the page
- [ ] Verify `/api/agents` endpoint is called
- [ ] Verify response contains array of agent information

## 2. Worktree Creation with Agent Selection
### Default Agent Selection
- [ ] Click "+" button to create new worktree
- [ ] Verify agent dropdown appears with available agents
- [ ] Verify Claude is selected by default (if available)
- [ ] Verify unavailable agents are disabled in dropdown

### Creating Worktree with Specific Agent
- [ ] Create worktree with Claude agent
- [ ] Verify worktree is created successfully
- [ ] Verify Claude instance starts automatically
- [ ] Repeat for each available agent (Codex, Gemini, etc.)

### Agent Badge Display
- [ ] Verify agent badge appears next to worktree name
- [ ] Verify badge shows correct agent type
- [ ] Verify badge color indicates agent status

## 3. Agent Instance Management
### Starting Instances
- [ ] Select a worktree
- [ ] Click "Start Agent" if instance is stopped
- [ ] Verify instance starts with correct agent type
- [ ] Verify status changes to "Running"
- [ ] Verify terminal becomes available

### Stopping Instances
- [ ] Click "Stop" button on running instance
- [ ] Verify instance stops cleanly
- [ ] Verify status changes to "Stopped"
- [ ] Verify terminal session ends

### Restarting Instances
- [ ] Click "Restart" button on running instance
- [ ] Verify instance stops and starts again
- [ ] Verify new instance uses same agent type
- [ ] Verify terminal reconnects

## 4. Terminal Interaction
### Agent-Specific Commands
- [ ] Open terminal for Claude instance
- [ ] Type a question and verify response
- [ ] Open terminal for Codex instance
- [ ] Verify Codex-specific prompts and behavior
- [ ] Test other available agents similarly

### Terminal Persistence
- [ ] Type commands in terminal
- [ ] Switch to different worktree
- [ ] Switch back to original worktree
- [ ] Verify terminal history is preserved

## 5. Multi-Agent Scenarios
### Multiple Agents Same Repository
- [ ] Create worktree with Claude
- [ ] Create another worktree with Codex
- [ ] Verify both instances run simultaneously
- [ ] Verify correct agent badges on each worktree

### Agent Switching
- [ ] Start instance with one agent
- [ ] Stop the instance
- [ ] Start new instance with different agent
- [ ] Verify new agent type is used

## 6. Error Handling
### Unavailable Agent
- [ ] Try to create worktree with uninstalled agent
- [ ] Verify appropriate error message
- [ ] Verify system continues to function

### Authentication Issues
- [ ] Use agent that requires authentication without auth
- [ ] Verify warning in System Status
- [ ] Verify agent is disabled in dropdown

### Instance Crashes
- [ ] Simulate agent crash (kill process manually)
- [ ] Verify error status is shown
- [ ] Verify restart button is available

## 7. Data Persistence
### Worktree Preferences
- [ ] Create worktree with specific agent
- [ ] Restart application
- [ ] Verify agent preference is remembered

### Instance State
- [ ] Start several instances
- [ ] Refresh page
- [ ] Verify instance states are preserved

## 8. UI/UX Polish
### Agent Selection UI
- [ ] Verify dropdown is styled consistently
- [ ] Verify tooltips show helpful information
- [ ] Verify disabled state is clearly indicated

### Badge Display
- [ ] Verify badges don't overlap text
- [ ] Verify badges are readable in both themes
- [ ] Verify compact badges in worktree list

### Loading States
- [ ] Verify loading indicators during agent operations
- [ ] Verify smooth transitions between states

## 9. Performance
### Multiple Instances
- [ ] Start 5+ instances with different agents
- [ ] Verify UI remains responsive
- [ ] Verify terminal switching is fast

### Memory Usage
- [ ] Monitor browser memory with multiple instances
- [ ] Verify no memory leaks on instance stop/start

## 10. Edge Cases
### Rapid Operations
- [ ] Rapidly start/stop instances
- [ ] Rapidly switch between worktrees
- [ ] Verify no race conditions or errors

### Network Issues
- [ ] Simulate network disconnection
- [ ] Verify appropriate error handling
- [ ] Verify recovery on reconnection

## Post-Test Verification
- [ ] Check browser console for errors
- [ ] Check server logs for errors
- [ ] Verify database integrity
- [ ] Verify no orphaned processes

## Test Results
- Date Tested: ___________
- Tester: ___________
- Agents Tested: ___________
- Issues Found: ___________
- All Tests Passed: [ ] Yes [ ] No