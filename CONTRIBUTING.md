# Contributing

Bob Builder is an early ForgeGraph prototype. Community process should make
small contributions easy without implying a production support promise.

## License Direction

The repository currently uses GPL-3.0. Pending legal review, the recommended
direction is to keep strong copyleft for the core ForgeGraph/Bob code while the
self-hosted product shape is still forming.

Tradeoffs to keep explicit:

- GPL-3.0 protects redistributed forks and keeps improvements open when people
  ship modified copies, but it does not close the hosted-service loophole.
- AGPL-3.0 would better deter direct hosted competition that runs modified code
  as a service, but it raises adoption friction for companies and contributors.
- Apache-2.0 or MIT would maximize adoption and integration, but make it easier
  for a hosted competitor to build proprietary extensions without contributing
  back.

Do not change license headers, package metadata, or the root `LICENSE` file
without a maintainer decision and legal skim.

## Contributor Journey

1. Read the README and run the development setup from a clean checkout.
2. Pick an issue labeled `good first issue`, or open an issue before starting a
   larger change.
3. Keep pull requests focused. Include screenshots for UI changes and note any
   skipped tests.
4. Expect maintainers to ask for scope reductions when a prototype area is
   changing quickly.

## Good First Issue Policy

Use `good first issue` only when all of these are true:

- The task can be completed without product roadmap context or private systems.
- The expected behavior and acceptance criteria are written in the issue.
- The change is low-risk: docs, tests, small UI copy, or isolated bug fixes.
- A maintainer can review it in 30 minutes or less.
- The issue names the relevant files or entry points when they are known.

Remove the label if the issue grows into architectural, security, data model, or
cross-package work.

## Maintainer Response SLA

This is a prototype, so response expectations are intentionally modest:

- Security reports: acknowledge within 3 business days.
- First-time contributor pull requests: first response within 7 business days.
- `good first issue` questions: response within 5 business days.
- RFCs and roadmap proposals: response within 10 business days.

If maintainers miss an SLA, contributors may ping once on the original thread.

## Lightweight RFC Process

Use an RFC for changes that affect public APIs, storage schema, agent behavior,
workflow semantics, or community policy.

1. Open a GitHub Discussion or issue titled `RFC: <short proposal>`.
2. Include problem, proposed change, alternatives, rollout, and unresolved
   questions.
3. Leave the RFC open for at least 5 business days unless it is fixing an
   urgent regression.
4. A maintainer closes with one of: accepted, accepted with changes, declined,
   or needs prototype evidence.

## Code of Conduct

Bob Builder includes a lightweight [Code of Conduct](./CODE_OF_CONDUCT.md). It
exists now because public issue trackers need a clear moderation baseline before
a launch post. Maintainers can replace it with a fuller policy later.

## Community Channels

GitHub Issues and Pull Requests are the source of truth. GitHub Discussions
should be enabled before any broad OSS launch and used for Q&A, RFCs, and
showcase posts.

Do not start Discord or Slack until there are at least two active maintainers
available for moderation. Chat creates real-time support expectations that do
not match the current prototype stage.

Minimum moderation baseline:

- Keep technical decisions in GitHub so they are searchable.
- Remove spam and abusive content when seen.
- Redirect support requests without reproduction steps back to issue templates.
- Lock threads only when discussion is no longer actionable or violates the
  Code of Conduct.

## Launch Readiness

Before a Show HN, reddit OSS, or similar launch post, the repo should have:

- A clean `pnpm install` path and documented required services.
- A working smoke-test command or manual verification checklist.
- Current README screenshots or terminal examples.
- Issue templates for bugs, feature requests, and RFCs.
- At least three labeled `good first issue` tasks.
- Triage ownership for the first week after launch.
