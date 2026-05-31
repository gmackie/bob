# ForgeGraph Developer Marketing and Technical Content Roadmap

**Issue:** GMA-51
**Date:** 2026-05-31
**Status:** Editorial calendar stub
**Primary CTA:** Install ForgeGraph locally and star the repo after the first successful run.

## Positioning

ForgeGraph is still a prototype, so content should earn trust with working paths,
transparent comparisons, and clear limits. The content program should avoid broad
"AI dev platform" claims and instead show developers exactly what ForgeGraph can
do today: model work, run locally, capture delivery state, and keep deployment
decisions visible.

Every asset should use the same next step:

```text
Try the local prototype: install ForgeGraph, run the quickstart, and star the repo after your first successful run.
```

Secondary CTAs such as Discord, waitlist, or newsletter can appear below the
primary CTA, but they should not replace it.

## Content Pillars

| Pillar                                 | Audience                                                                                                           | Promise                                                                                                | Proof standard                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Ship faster self-hosted                | Indie hackers, solo founders, and small teams already using coding agents                                          | Run a local workflow from work item to deploy signal without adopting a hosted control plane first     | End-to-end terminal walkthroughs, local setup guides, real config snippets, elapsed time, and failure cases |
| Escape PaaS lock-in                    | DevOps-minded founders and platform engineers evaluating Vercel, Render, Railway, Fly.io, or custom CI/CD          | Keep delivery state and policy in your own graph instead of burying it inside one provider's dashboard | Architecture comparisons, migration paths, data model diagrams, and explicit tradeoffs                      |
| Ops minimalism for agentic development | Senior full-stack developers and small-team technical leads using Claude Code, Codex, Cursor, Aider, or smol-agent | Add just enough structure around agents to know what changed, what passed, and what is safe to promote | Agent run examples, review gates, build/deploy state traces, and honest "not ready for teams yet" notes     |

## 90-Day Backlog

| Week | Deliverable                                                                           | Format                    | Pillar                  | Audience                                          | Rough effort | Distribution                                                                                                 |
| ---- | ------------------------------------------------------------------------------------- | ------------------------- | ----------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| 1    | "ForgeGraph prototype quickstart: local work graph in 15 minutes"                     | Tutorial                  | Ship faster self-hosted | Indie hackers, local-first dev tool users         | M            | GitHub README/docs, X thread, r/selfhosted, r/SideProject, Indie Hackers, DevTools FM Discord                |
| 2    | Terminal GIF: create work item, run agent, capture artifact, update delivery state    | Terminal GIF + short post | Ops minimalism          | Agent tool users                                  | S            | GitHub repo social preview, X, Mastodon `#devtools`, Discords: Latent Space, AI Engineer, Cursor Community   |
| 3    | "What ForgeGraph is not yet"                                                          | Honest limits post        | All                     | Skeptical senior developers                       | S            | GitHub Discussions, HN "Show HN" comment follow-up, r/programming, r/devops, product site changelog          |
| 4    | "ForgeGraph vs PaaS deployment dashboards: what belongs in the work graph?"           | Architecture comparison   | Escape PaaS lock-in     | DevOps founders, platform engineers               | L            | HN, r/devops, r/kubernetes, r/selfhosted, X, LinkedIn founder/devops audience                                |
| 5    | "Self-hosted agent workflow with Claude Code or Codex"                                | Tutorial                  | Ship faster self-hosted | Coding-agent power users                          | M            | GitHub docs, r/ClaudeAI, r/OpenAI, Cursor Community Discord, AI Engineer Discord                             |
| 6    | Release post: prototype milestone 0.1 with install path, known limits, and next gates | Release post              | All                     | Early adopters                                    | M            | GitHub Releases, GitHub Discussions, X, r/SideProject, Indie Hackers, relevant Discord announcement channels |
| 7    | "A minimal delivery state machine for indie products"                                 | Architecture post         | Ops minimalism          | Small-team technical leads                        | M            | HN, r/softwarearchitecture, r/devops, personal/founder blog, LinkedIn                                        |
| 8    | Terminal GIF: failure path showing failed build and blocked promotion                 | Terminal GIF + short post | Ops minimalism          | Developers who distrust happy-path demos          | S            | X, GitHub Discussions, r/devops, Latent Space Discord, smol-ai/developer Discord pockets                     |
| 10   | "From GitHub issue to deploy gate: mapping work items to delivery state"              | Tutorial                  | Escape PaaS lock-in     | GitHub-first teams                                | L            | GitHub docs, r/github, r/devops, HN, DevTools FM Discord                                                     |
| 12   | "90 days of ForgeGraph: what we learned from prototype users"                         | Retrospective + roadmap   | All                     | Early adopters, indie founders, DevOps evaluators | M            | GitHub Discussions, HN, Indie Hackers, X, newsletter/waitlist                                                |

Effort scale:

- S: 0.5-1 day, mostly capture/edit/publish.
- M: 1-2 days, requires working reproduction and screenshots or GIFs.
- L: 3-5 days, requires architecture review, diagrams, and technical comparison.

## Distribution Notes

Use one canonical source URL per asset, then syndicate short excerpts or discussion
prompts rather than duplicating the full article everywhere.

| Channel                               | Use                                                        | Fit                                                                   |
| ------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| GitHub README/docs                    | Canonical tutorial and install content                     | Developers evaluating whether the prototype works                     |
| GitHub Releases                       | Milestone updates with changelog and known limits          | Existing watchers and star-driven discovery                           |
| GitHub Discussions                    | Demo threads, limits, Q&A, early user feedback             | Converts drive-by interest into product feedback                      |
| Hacker News                           | Architecture comparisons, Show HN, retrospectives          | Skeptical developer audience; only post when the demo is reproducible |
| Reddit r/selfhosted                   | Self-hosted quickstart and local deployment notes          | Users who care about local ownership and operational clarity          |
| Reddit r/devops                       | State machine, deploy gates, failure-path content          | DevOps audience; avoid hype and lead with tradeoffs                   |
| Reddit r/kubernetes                   | Only use for integration or deployment architecture posts  | Keep posts concrete; do not force Kubernetes framing                  |
| Reddit r/SideProject                  | Prototype milestones and founder build logs                | Indie/small-team inbound                                              |
| Reddit r/programming                  | Technical architecture posts only                          | Broad technical reach when content is strong enough                   |
| Reddit r/ClaudeAI, r/OpenAI, r/Cursor | Agent workflow tutorials                                   | Developer-agent users who need structure around runs                  |
| Indie Hackers                         | Founder build log and milestone posts                      | Solo founder audience                                                 |
| X                                     | GIFs, diagrams, release threads, sharp comparison snippets | Fast feedback and repeat exposure                                     |
| LinkedIn                              | Founder/platform-engineering angle                         | Small-company technical leadership                                    |
| Discord: Latent Space                 | Agent workflow and AI engineering demos                    | Agentic dev audience                                                  |
| Discord: AI Engineer                  | Agent run capture and evaluation workflow                  | AI builders and toolsmiths                                            |
| Discord: Cursor Community             | Coding-agent workflow examples                             | Cursor-heavy indie developers                                         |
| Discord: DevTools FM                  | Dev tool launches and architecture discussion              | Developer tool practitioners                                          |

## SEO and Technical SEO

| Keyword or phrase                   | Landing intent | Target asset                                 |
| ----------------------------------- | -------------- | -------------------------------------------- |
| self hosted developer workflow      | Informational  | Quickstart tutorial and landing page section |
| open source deployment dashboard    | Tool           | Comparison page with install CTA             |
| agentic development workflow        | Informational  | Agent workflow tutorial                      |
| GitHub issue to deployment pipeline | Informational  | GitHub issue to deploy gate tutorial         |
| PaaS lock-in alternative            | Tool           | PaaS comparison architecture post            |

Technical SEO requirements:

- Publish canonical long-form pages under stable, descriptive slugs.
- Add `title`, `description`, Open Graph image, and code-heavy structured headings for each article.
- Include copyable install commands near the top of tool-intent pages.
- Cross-link each article to the quickstart, known limits post, and latest release.
- Keep prototype caveats indexable; trust-building pages should not be hidden in Discord-only updates.

## Editorial Calendar Stub

| Date       | Asset                               | Owner | Status  | Primary CTA                   |
| ---------- | ----------------------------------- | ----- | ------- | ----------------------------- |
| 2026-06-03 | ForgeGraph prototype quickstart     | TBD   | Draft   | Install locally and star repo |
| 2026-06-10 | First terminal GIF demo             | TBD   | Planned | Install locally and star repo |
| 2026-06-17 | What ForgeGraph is not yet          | TBD   | Planned | Install locally and star repo |
| 2026-06-24 | ForgeGraph vs PaaS dashboards       | TBD   | Planned | Install locally and star repo |
| 2026-07-01 | Self-hosted agent workflow tutorial | TBD   | Planned | Install locally and star repo |
| 2026-07-08 | Prototype milestone release post    | TBD   | Planned | Install locally and star repo |
| 2026-07-15 | Minimal delivery state machine      | TBD   | Planned | Install locally and star repo |
| 2026-07-29 | Failure-path terminal GIF           | TBD   | Planned | Install locally and star repo |
| 2026-08-12 | GitHub issue to deploy gate         | TBD   | Planned | Install locally and star repo |
| 2026-08-26 | 90-day learning retrospective       | TBD   | Planned | Install locally and star repo |

## Linear Issue Comment Draft

```markdown
GMA-51 editorial calendar stub is committed here:

`docs/plans/2026-05-31-forgegraph-developer-marketing-roadmap.md`

It includes:

- 3 content pillars with audience and proof standards
- 90-day backlog of 10 deliverables with format, effort, and distribution
- Specific DevOps/indie dev distribution targets
- 5 SEO target phrases with landing intent
- Standard primary CTA for every asset
- Calendar stub dates through 2026-08-26

Primary CTA: install ForgeGraph locally, run the quickstart, and star the repo after the first successful run.
```

## Open Follow-Up

The roadmap is ready to paste into Linear or move into Notion. This repository
does not include a Linear or Notion integration, so the actual issue comment/link
still needs to be posted manually by someone with access.
