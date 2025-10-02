# Repository Dashboard Design Document

## Overview

This document outlines the design and implementation plan for enhancing Bob's repository dashboard feature. The dashboard provides a comprehensive view of repository information, git data, build status, and project management capabilities.

## Current State Analysis

### Existing Features
- ✅ **Navigation**: Repository names in RepositoryPanel are clickable and navigate to `/repository/${repo.id}`
- ✅ **Basic Dashboard**: Functional dashboard with tabs (overview, branches, git graph, project notes)
- ✅ **API Endpoints**: Most required endpoints already exist (remotes, branches, git graph, project notes)
- ✅ **Git Integration**: Remote repositories, branch information, and commit graph visualization
- ✅ **Project Management**: Notes system using .bob-repo.md files in `docs/notes/` directory

### Architecture
- **Frontend**: React with TypeScript, React Router for navigation
- **Backend**: Express.js API with SQLite database
- **Git Operations**: Direct git commands executed via GitService
- **File System**: Project notes stored in repository's `docs/notes/.bob-repo.md`

## Enhancement Plan

### 1. Repository Dashboard Navigation ✅ (Already Implemented)
- Repository names in the left panel are clickable with dashboard emoji (📊)
- Navigation uses React Router to `/repository/${repositoryId}`
- Current implementation in `RepositoryPanel.tsx:187-199`

### 2. Enhanced Remote Repository Integration ✅ (Already Implemented)
- Display all remote repositories with appropriate icons (GitHub 🐙, GitLab 🦊, Bitbucket 🪣)
- Convert SSH URLs to HTTPS for web viewing
- Direct links to remote repositories
- Current implementation in `RepositoryDashboard.tsx:95-112`

### 3. Git Graph Visualization ✅ (Already Implemented)
- SVG-based commit graph with nodes and connections
- Color-coded branches (main branch in green, others in blue)
- Interactive display showing commit hash, message, and author
- Current implementation in `RepositoryDashboard.tsx:277-323`

### 4. Branch Management and Status ⚠️ (Partially Implemented)
**Current**: Basic branch listing with local/remote indicators
**Enhancement Needed**:
- Build status integration (CI/CD status indicators)
- Test result summary (passing/failing counts)
- Branch actions (create worktree, merge status)
- Last build information and links to CI systems

### 5. Project Management System ✅ (Already Implemented)
- Markdown-based notes stored in `docs/notes/.bob-repo.md`
- Rich text editor with save/cancel functionality
- Simple markdown rendering for display
- Automatic creation of notes directory structure

### 6. System Integration Enhancements 🔄 (Needs Implementation)
**Build Status Integration**:
- GitHub Actions status integration
- GitLab CI/CD pipeline status
- Jenkins build status (if applicable)
- Generic CI/CD webhook support

**Test Results Display**:
- Parse test output from CI systems
- Display pass/fail counts per branch
- Link to full test reports
- Historical test trend analysis

## Implementation Steps

### Phase 1: Build Status Integration
1. **GitHub Actions Integration**
   - Add GitHub API client for workflow status
   - Display workflow status badges on branches
   - Link to GitHub Actions page for each workflow

2. **Generic CI/CD Support**
   - Support for status badges from common CI providers
   - Configurable CI/CD URL patterns
   - Webhook endpoints for real-time status updates

### Phase 2: Enhanced Branch Management
1. **Branch Actions**
   - "Create Worktree" button functionality (partially implemented)
   - Merge status indicators
   - Protected branch indicators
   - Stale branch detection

2. **Test Results Integration**
   - Parse test results from CI systems
   - Display test metrics (total, passed, failed, skipped)
   - Historical trend charts
   - Failed test details

### Phase 3: Advanced Features
1. **Performance Metrics**
   - Build time tracking
   - Repository size metrics
   - Commit frequency analysis
   - Contributor activity heatmaps

2. **Enhanced Project Management**
   - Issue integration (GitHub Issues, GitLab Issues)
   - Milestone tracking
   - PR/MR status summary
   - Project templates and workflows

## API Enhancements Needed

### New Endpoints Required

```typescript
// Build Status Integration
GET /repositories/:id/build-status
GET /repositories/:id/branches/:branch/build-status
GET /repositories/:id/test-results
GET /repositories/:id/branches/:branch/test-results

// Enhanced Git Information
GET /repositories/:id/branches/:branch/merge-status
GET /repositories/:id/protected-branches
GET /repositories/:id/commit-stats

// CI/CD Integration
POST /repositories/:id/webhooks/ci-status
GET /repositories/:id/workflows
GET /repositories/:id/workflows/:workflow/runs
```

### Database Schema Additions

```sql
-- Build status tracking
CREATE TABLE build_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  build_id TEXT,
  status TEXT CHECK(status IN ('pending', 'running', 'success', 'failure', 'cancelled')),
  url TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repository_id) REFERENCES repositories (id)
);

-- Test results tracking
CREATE TABLE test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  build_id TEXT,
  total_tests INTEGER DEFAULT 0,
  passed_tests INTEGER DEFAULT 0,
  failed_tests INTEGER DEFAULT 0,
  skipped_tests INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repository_id) REFERENCES repositories (id)
);
```

## User Experience Flow

### Repository Dashboard Access
1. User clicks repository name in left panel (with 📊 indicator)
2. Navigate to `/repository/{id}` route
3. Dashboard loads with repository overview, git data, and management tools

### Build Status Workflow
1. Dashboard displays current build status for all branches
2. Users can click status badges to view detailed build information
3. Real-time updates via WebSocket or polling for active builds
4. Historical build data available in dedicated tab

### Project Management Workflow
1. Users access "Project Notes" tab for Markdown-based documentation
2. Notes are stored in repository's `docs/notes/.bob-repo.md` file
3. Rich editing with live preview and auto-save functionality
4. Integration with git for versioning project documentation

## Technical Considerations

### Performance
- Lazy loading of git graph data for large repositories
- Caching of build status and test results
- Efficient polling strategies for real-time updates
- Database indexing for quick repository lookups

### Security
- GitHub token management for API access
- Webhook signature verification for CI/CD updates
- Repository access control and permissions
- Secure storage of external API credentials

### Extensibility
- Plugin architecture for additional CI/CD providers
- Configurable dashboard widgets and layouts
- Custom project management templates
- Integration hooks for external tools

## Success Metrics

### User Engagement
- Repository dashboard usage frequency
- Time spent on dashboard vs. terminal interface
- Feature adoption rates (build status, project notes, etc.)

### Development Efficiency
- Reduced time to identify build failures
- Improved project documentation maintenance
- Faster worktree creation and branch management

### System Performance
- Dashboard load times under 2 seconds
- Real-time update latency under 5 seconds
- API response times under 500ms for cached data

## Future Enhancements

### Advanced Git Features
- Interactive rebase visualization
- Merge conflict resolution interface
- Commit signing and verification status
- Advanced blame and history analysis

### Team Collaboration
- Multi-user session management
- Shared project notes and comments
- Team activity feeds and notifications
- Collaborative code review integration

### Analytics and Insights
- Repository health scoring
- Development velocity metrics
- Code quality trend analysis
- Automated project reporting

---

This design document serves as a living specification that will be updated as implementation progresses and requirements evolve.