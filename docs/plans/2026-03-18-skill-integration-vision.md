# Skill Integration Vision — Bob as Agent Orchestrator

## The Big Picture

Bob isn't just a project management tool that happens to have AI agents. Bob is the **orchestration layer** that coordinates multiple AI agents (Claude Code, Codex, custom agents) using **skills** (gstack, custom skill packs) to deliver software autonomously. The skills are what make the agents effective. The screen capture is what gives them eyes. Together, they create a closed-loop development system.

## What Sets Bob Apart

1. **Skill-aware agent sessions** — Bob knows which skills are available, which agent is best for each task, and which skills to invoke at each stage of the workflow.

2. **Skill execution visibility** — Users can see in the chat log exactly which skills were used, what they did, and what they produced. Not just "agent made changes" but "agent used /review to check the PR, found 2 issues, auto-fixed 1, flagged 1 for review."

3. **Screen capture as first-class** — The visual feedback loop (capture → analyze → act → verify) is built into every agent session, not bolted on. Agents can see what they're building.

4. **End-to-end cohesion** — From idea capture through deployment monitoring, every stage uses the same agent/skill/capture infrastructure. No seams between stages.

## Skill Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BOB PLATFORM                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Claude   │  │  Codex   │  │  Custom  │  │  Future  │   │
│  │  Code     │  │          │  │  Agent   │  │  Agent   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│       ▼              ▼              ▼              ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  SKILL REGISTRY                       │   │
│  │  /review  /ship  /qa  /browse  /brainstorm  /retro   │   │
│  │  /plan-ceo-review  /plan-eng-review  /design-review  │   │
│  │  /tdd  /debugging  /esp32  /unity-mcp  /deploy       │   │
│  └──────────────────────────────────────────────────────┘   │
│       │              │              │              │         │
│       ▼              ▼              ▼              ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 MCP TOOL LAYER                        │   │
│  │  filesystem · git · terminal · screen-capture         │   │
│  │  unity-mcp · gitea-mcp · harbor-mcp · k8s-mcp       │   │
│  └──────────────────────────────────────────────────────┘   │
│       │              │              │              │         │
│       ▼              ▼              ▼              ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              WORKSPACE + CAPTURE                      │   │
│  │  File tree · Terminal · Screen capture · Revisions    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Skill Visibility in Chat

When an agent uses a skill during a session, the chat log should show:

```
Bob  2:14 PM
I'm using /review to check this PR before merging.

  ┌─ SKILL: /review ──────────────────────────────────┐
  │ Pre-landing review of feature/wi-0043 → main      │
  │                                                     │
  │ ✓ SQL Safety: No issues                            │
  │ ✓ Trust Boundaries: No LLM output in SQL           │
  │ ⚠ Dead Code: Unused import on line 42              │
  │   → AUTO-FIXED                                      │
  │                                                     │
  │ Result: 1 issue found, 1 auto-fixed                │
  │ Duration: 12s                                       │
  └─────────────────────────────────────────────────────┘

Review passed. PR is ready to merge.
```

This is different from the existing MCP tool call blocks — those show raw tool calls (read_file, write_file). Skill blocks show the **higher-level workflow** that the agent is executing. Skills contain multiple tool calls, but the user sees the skill-level summary.

## Skill-to-Stage Mapping

Each workflow stage has default skills that Bob invokes:

| Stage    | Default Skills                                    |
|----------|--------------------------------------------------|
| Idea     | /brainstorm — refine the idea through questions   |
| Shape    | /plan-ceo-review — challenge premises, expand     |
| Plan     | /plan-eng-review — validate architecture          |
| Execute  | /tdd — write tests first, then implement          |
| Review   | /review — pre-landing checks, /qa — visual QA    |
| Deploy   | /ship — version bump, changelog, PR               |
| Live     | /retro — what went well, what to improve          |

Users can customize which skills are used per project via the automation settings.

## Screen Capture Integration Points

Screen capture isn't just in the workspace — it's available at every stage:

- **Shape**: Capture competitor screenshots for reference
- **Plan**: Capture wireframes/mockups from design tools
- **Execute**: Live preview of the app as the agent builds (browser + native)
- **Review**: Before/after visual diff for QA
- **Deploy**: Staging environment screenshots for verification
- **Live**: Production monitoring screenshots

The capture panel should be a **floating widget** available anywhere in Bob, not just in the workspace. Like a system-wide screenshot tool that's always one click away.

## Agent Selection Intelligence

Bob should recommend the best agent for each task based on:

- **Task type**: Code tasks → Claude Code. Infrastructure → Codex. Design → Claude with /browse.
- **Skill requirements**: Tasks needing /unity-mcp → agent with Unity MCP access.
- **Context**: Tasks in a Go repo → agent with Go expertise. React UI tasks → agent with /browse + screen capture.

This is the **agent routing** layer — Bob as the dispatcher that knows which agent to assign.

## Implementation Phases

### Phase 5A: Skill Registry + Visibility
- Skill registry: list of available skills with metadata (name, description, stage affinity)
- Skill execution blocks in chat (higher-level than MCP tool calls)
- Skill usage tracking (which skills used, how often, success rate)

### Phase 5B: Agent Selection + Routing
- Agent capability profiles (what MCP servers, what skills, what languages)
- Task-to-agent matching algorithm
- Agent selection UI on dispatch (recommend best agent, allow override)

### Phase 5C: Floating Capture Widget
- System-wide capture button (available on all pages)
- Quick capture → paste into chat or attach to work item
- Capture gallery per project (all captures organized by stage)

### Phase 5D: Skill Marketplace
- Browse and install skills (like gstack skill packs)
- Per-project skill configuration
- Custom skill creation (write a skill, test it, share it)
