# @linear-clone/funnel-agent-skills

Installable agent skills for funnel-aware work and artifact execution.

## Install with npx

```bash
npx @linear-clone/funnel-agent-skills install
npx -p @linear-clone/funnel-agent-skills skills install
```

By default, skills are installed into:

1. `~/.codex/skills` (preferred)
2. `~/.agents/skills` (fallback)

You can pass a custom destination:

```bash
npx @linear-clone/funnel-agent-skills install /path/to/skills
```

## What this installs

- `skills/funnel-artifact-authoring/SKILL.md`
- `skills/funnel-issue-execution/SKILL.md`

Both skills are compatible with the existing `use-skill` flow and the funnel artifact metadata already used by:

- `funnelArtifactType`
- `funnelStage`
- `get_project_agent_context` MCP/API context.
