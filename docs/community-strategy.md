# ForgeGraph Community Strategy

This outline records the current open-source community posture for GMA-52. It
is intentionally lightweight and should be revisited after the prototype has a
stable install path and a clearer support load.

## Positioning

ForgeGraph should lead with an indie DevOps and self-hosted contribution model:
transparent license posture, searchable public decisions, and small starter
issues that do not require private roadmap context.

Community strategy should start before launch, but public promotion should lag
product reliability. Early community work should improve contributor UX rather
than create a real-time support burden.

## License Recommendation

Recommended default: keep GPL-3.0 for now, pending legal skim.

Why:

- The repo already uses GPL-3.0, so the contribution baseline is clear today.
- Strong copyleft fits a self-hosted DevOps project where redistributed forks
  should remain open.
- A later move to AGPL-3.0 can be considered if hosted clone risk becomes more
  important than enterprise adoption friction.

Alternatives:

- AGPL-3.0: stronger hosted-service protection, higher adoption friction.
- Apache-2.0: strong permissive option with patent language, weaker protection
  against proprietary hosted competitors.
- MIT: simplest permissive option, least protection for the hosted business.

Decision needed before launch: confirm whether GPL-3.0 is enough or whether
network copyleft is necessary for ForgeGraph-hosted competition concerns.

## Contributor Policy

The `good first issue` label should mean a contributor can succeed from public
context alone. Candidate issues should include acceptance criteria, likely
files, expected verification, and maintainer willingness to review quickly.

Maintainer SLA:

- Security: 3 business days.
- Good-first-issue questions: 5 business days.
- First-time contributor PRs: 7 business days.
- RFCs: 10 business days.

These are response targets, not resolution promises.

## RFC Process

Use GitHub Discussions once enabled; otherwise use GitHub Issues with an
`RFC:` title. Required sections are problem, proposal, alternatives, rollout,
and unresolved questions. Keep the review window to 5 business days for normal
prototype changes.

## Channels

Recommended launch sequence:

1. GitHub Issues and Pull Requests only.
2. Enable GitHub Discussions for Q&A, RFCs, and showcase posts before launch.
3. Defer Discord or Slack until there are at least two active moderators.

Moderation minimums are the lightweight Code of Conduct, spam removal,
searchable technical decisions, and thread locks for non-actionable escalation.

## Contributor Journey

Repo-level docs should include:

- README contribution segment.
- `CONTRIBUTING.md` with license posture, issue policy, SLA, RFCs, channels,
  and launch readiness.
- `CODE_OF_CONDUCT.md` with a simple moderation baseline.
- Issue templates before a broad launch post.

## Launch Gate

Do not post to Show HN, reddit OSS communities, or similar broad channels until:

- New contributors can install dependencies from a clean checkout.
- A smoke test or manual verification checklist is current.
- README docs explain what ForgeGraph is and how to try it.
- Issues and Discussions have a maintainer triage owner for the launch week.
- At least three contribution-friendly issues are filed or labeled.

## Starter Issue Backlog

File or label these as `good first issue` once GitHub Issues are enabled for
the public repo:

1. Document clean checkout prerequisites for local development.
   - Update README or docs with Node, pnpm, database, and environment
     prerequisites.
   - Verify the setup path from `package.json` and existing docs.
2. Add a smoke-test command reference for contributors.
   - Identify the lightest commands a contributor should run before opening a
     docs-only, UI, or backend PR.
   - Document expected runtime and any known local-service assumptions.
3. Add GitHub issue templates for bugs, feature requests, and RFCs.
   - Keep templates short and prototype-friendly.
   - Include reproduction steps, expected behavior, verification, and affected
     package or app fields.
