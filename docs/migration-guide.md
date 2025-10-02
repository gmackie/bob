# Migration Guide: Claude-Only to Multi-Agent Bob

This guide helps you upgrade from the Claude-only version of Bob to the new multi-agent version.

## What's New

- **Multi-Agent Support**: Use Claude, Codex, Gemini, Amazon Q, Cursor Agent, or OpenCode
- **Agent Selection**: Choose agent when creating worktrees
- **Agent Badges**: Visual indicators show which agent is being used
- **System Status**: Comprehensive dashboard shows all agent statuses
- **Configuration System**: Customize agent preferences and behaviors

## Database Migration

The database automatically migrates when you first run the new version.

### Automatic Changes

1. **New Tables**:
   - `agent_instances` table replaces `claude_instances`
   - Existing instances are preserved

2. **New Columns**:
   - `preferred_agent` added to worktrees (defaults to 'claude')
   - `agent_type` added to instances

3. **Data Preservation**:
   - All existing worktrees continue working
   - All Claude instances remain functional
   - No data loss during migration

### Manual Migration (if needed)

```bash
# Backup database first
cp ~/.bob/bob.db ~/.bob/bob.db.backup

# Run migrations
cd backend
npm run migrate:up
```

## Code Changes

### API Changes

#### Before (Claude-only):
```javascript
// Start Claude instance
await api.startClaudeInstance(worktreeId);
```

#### After (Multi-agent):
```javascript
// Start instance with specific agent
await api.startInstance(worktreeId, 'claude');
// Or use default agent
await api.startInstance(worktreeId);
```

### Type Changes

#### Before:
```typescript
interface ClaudeInstance {
  id: string;
  worktreeId: string;
  status: string;
}
```

#### After:
```typescript
interface AgentInstance {
  id: string;
  worktreeId: string;
  agentType: AgentType;
  status: string;
}

// ClaudeInstance is aliased for compatibility
type ClaudeInstance = AgentInstance;
```

## Configuration

### New Configuration File

Create `backend/config/agents.json` (or use defaults):

```json
{
  "agents": {
    "claude": {
      "enabled": true,
      "default": true,
      "priority": 1
    }
  },
  "preferences": {
    "defaultAgent": "claude",
    "fallbackOrder": ["claude", "codex", "gemini"]
  }
}
```

### User Preferences

User preferences are stored in `~/.bob/config.json`:

```json
{
  "preferences": {
    "defaultAgent": "claude"
  }
}
```

## UI Changes

### Repository Panel
- **New**: Agent selector dropdown when creating worktrees
- **New**: Agent badges next to worktree names
- **Changed**: "Claude" tab renamed to "Agent"

### System Status
- **New**: Shows all available agents
- **New**: Authentication status for each agent
- **Enhanced**: More detailed status information

## Breaking Changes

### Removed
- `ClaudeService` class (replaced by `AgentService`)
- `/api/claude/*` endpoints (replaced by `/api/instances/*`)

### Changed
- `startClaudeInstance()` → `startInstance()`
- `ClaudeInstance` type → `AgentInstance` type
- Database table `claude_instances` → `agent_instances`

## Rollback Procedure

If you need to rollback:

1. **Stop Bob**
   ```bash
   # Kill all processes
   pkill -f "npm.*dev"
   ```

2. **Restore Database**
   ```bash
   cp ~/.bob/bob.db.backup ~/.bob/bob.db
   ```

3. **Checkout Previous Version**
   ```bash
   git checkout <previous-commit>
   ```

4. **Reinstall Dependencies**
   ```bash
   npm install
   ```

5. **Start Bob**
   ```bash
   npm run dev:clean
   ```

## Common Issues

### Issue: Existing worktrees don't work
**Solution**: The migration should handle this automatically. If not:
```sql
-- Update worktrees to have preferred_agent
UPDATE worktrees SET preferred_agent = 'claude' WHERE preferred_agent IS NULL;
```

### Issue: Claude instances not starting
**Solution**: Ensure Claude CLI is still installed:
```bash
claude --version
```

### Issue: Database migration fails
**Solution**: Reset and re-run:
```bash
npm run migrate:reset
npm run migrate:up
```

### Issue: Type errors in custom code
**Solution**: Update imports:
```typescript
// Old
import { ClaudeInstance } from './types';

// New
import { AgentInstance, ClaudeInstance } from './types';
// ClaudeInstance is aliased to AgentInstance
```

## Testing After Migration

1. **Verify Existing Worktrees**
   - Open Bob
   - Check all worktrees appear
   - Start instances for existing worktrees

2. **Test Claude Compatibility**
   - Create new worktree with Claude
   - Verify Claude instance starts
   - Test terminal interaction

3. **Test New Agents**
   - Install another agent CLI
   - Create worktree with new agent
   - Verify it works

4. **Check System Status**
   - Open System Status dashboard
   - Verify all agents show correct status
   - Check authentication states

## Performance Considerations

- **Memory**: Each agent instance uses ~100-200MB
- **CPU**: Multiple agents may increase CPU usage
- **Recommendation**: Limit to 3-4 concurrent instances

## Support

If you encounter issues:

1. Check `~/.bob/logs/` for error messages
2. Review this migration guide
3. Check the [GitHub Issues](https://github.com/your-repo/bob/issues)
4. File a new issue with:
   - Error messages
   - Bob version (before and after)
   - Agent types being used

## Future Compatibility

The multi-agent architecture is designed for extensibility:
- New agents can be added without breaking changes
- Configuration system allows for new preferences
- Database schema supports additional agent metadata

Your migrated installation will continue working with future updates.