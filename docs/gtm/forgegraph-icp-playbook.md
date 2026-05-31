# ForgeGraph ICP Playbook

**Issue:** GMA-49
**Status:** Draft hypothesis for validation
**Audience:** indie developers and small teams shipping web services without a platform team

## Positioning Premise

ForgeGraph is for builders who already ship web services and feel the pain of fragile deploys, unclear agent changes, and production confidence gaps. The first market is not broad DevOps buyers or mobile-first app teams; it is repo-owning developers who can clone, configure, and evaluate a deployment workflow themselves.

The core promise to test: predictable deploys and reviewable delivery flow in less than 30 minutes from clone to first useful deployment signal.

## Segments

### 1. Solo SaaS Founder

**Profile:** One technical founder maintaining a revenue-generating or soon-to-launch web app. Usually owns product, code, deployment, support, and incident response.

**Jobs to be done:**

- Ship small changes without rebuilding a personal deploy checklist each time.
- Know whether an AI-generated change is safe enough to merge or deploy.
- Keep staging, production, and rollback state visible without adopting a heavy platform.

**Urgency triggers:**

- Recent failed production deploy or manual rollback.
- Launch deadline, demo, or paid customer onboarding.
- Moving from hobby hosting to a paid service where downtime matters.
- Adding coding agents but lacking confidence in their diffs and test output.

**Outreach angle:** "Clone ForgeGraph, connect one repo, and get a visible build/deploy trail before your next customer-facing change."

### 2. Agency Pod of 2-8 Developers

**Profile:** Small client-service team shipping and maintaining multiple web properties, often across Vercel, Fly.io, Render, Hetzner, or VPS setups. One senior developer informally owns release quality.

**Jobs to be done:**

- Standardize deploy handoff across client repos without hiring DevOps.
- Make review, build, deploy, and live status legible to the whole pod.
- Reduce client-impacting regressions caused by rushed merges or unclear environments.

**Urgency triggers:**

- A client asks for better release visibility or auditability.
- Multiple projects have drifted deploy scripts and undocumented environment assumptions.
- The team starts using agents or contractors and needs a shared quality gate.
- A senior developer is becoming the deployment bottleneck.

**Outreach angle:** "Give every client repo the same lightweight release path without forcing the team onto a heavyweight platform."

### 3. Infra-Curious Startup Team

**Profile:** Three to fifteen engineers with one backend-leaning generalist handling infrastructure part-time. They are not ready for a platform team, but they have enough deployment surface area that ad hoc scripts are becoming risky.

**Jobs to be done:**

- Add deploy discipline before CI/CD sprawl becomes permanent.
- Make service state, revisions, and approvals visible without buying enterprise DevOps.
- Evaluate whether AI-assisted delivery can be trusted in a production workflow.

**Urgency triggers:**

- First enterprise customer, compliance questionnaire, or uptime commitment.
- Multiple services or environments appear before infra ownership is formalized.
- Release velocity increases and the team needs better deploy confidence.
- Leadership wants roadmap clarity on what infrastructure to build versus adopt.

**Outreach angle:** "Use ForgeGraph as the release spine while the team is still small enough to keep infrastructure simple."

## ICP Checklist

Prioritize accounts that meet most of these:

- Owns at least one active web service repo with real users or imminent launch pressure.
- Developer can run local CLI tools, clone repos, set environment variables, and inspect logs.
- Uses GitHub or another git host as the source of truth for code review and changes.
- Has a deploy target ForgeGraph can observe or orchestrate: VPS, Docker host, Fly.io, Render, Railway, Vercel, Hetzner, or similar.
- Has at least one non-production environment, preview flow, or desire to create one.
- Feels pain from manual deploys, unclear build state, untrusted agent output, or missing rollback confidence.
- Comfortable trying OSS or developer-tooling workflows before procurement.
- Accepts early-product rough edges in exchange for direct control and roadmap influence.
- Can evaluate first value in one repo within a single session.

Technical prerequisites to confirm before sales or onboarding:

- Node/pnpm or the documented runtime can be installed locally.
- Repo has a repeatable build or test command, even if imperfect.
- Service has a known deploy command, host API, or deploy script.
- Secrets can be provided through environment variables or a deploy target secret store.
- The evaluator has permission to connect repository and deployment metadata.

Hosting constraints that increase fit:

- Small number of services where clarity matters more than fleet-wide automation.
- Existing hosting is flexible enough to run a lightweight integration or CLI workflow.
- Team wants visible release gates but does not require a full internal platform.

## Disqualification List

Deprioritize or disqualify when:

- Buyer wants managed Kubernetes, enterprise SSO, SOC 2 evidence, procurement, or audit exports before trial.
- Team has a mature platform team with standardized CI/CD and only wants incremental dashboarding.
- Product is mobile-only or App Store-only with no web service deploy path to validate.
- Repo cannot be cloned or instrumented by the evaluator.
- Deployment is fully outsourced and the team cannot change release workflow.
- Build or deploy steps are intentionally opaque, manual-only, or owned by a vendor.
- The team is not comfortable with OSS, CLI-first setup, or early-access developer tools.
- They need named-lead sales support before a technical champion has tried the product.

## First 20 Accounts Hypothesis

These are account and community hypotheses, not named leads. The goal is to find technical champions who can pull the repo first.

| #   | Hypothesis                                                    | Segment               | Why it may fit                                   | Initial angle                                                      |
| --- | ------------------------------------------------------------- | --------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | Indie SaaS founders in build-in-public communities            | Solo SaaS             | Shipping pressure and visible launch cadence     | "Make deploy confidence part of launch readiness."                 |
| 2   | Micro-SaaS founders on Indie Hackers                          | Solo SaaS             | Many own code and hosting directly               | "Get a repeatable release path before the first paid users."       |
| 3   | Developers selling self-hosted B2B tools                      | Solo SaaS             | Customers care about uptime and upgrade safety   | "Track revisions and deploy health without building a platform."   |
| 4   | AI-native solo founders using coding agents daily             | Solo SaaS             | Agent trust gap is acute                         | "See what the agent changed, tested, and deployed."                |
| 5   | Open-source maintainers with hosted demos                     | Solo SaaS             | Need public confidence and simple deploys        | "Turn the demo app into a repeatable release workflow."            |
| 6   | Newsletter/course creators running paid web apps              | Solo SaaS             | Small teams, deadline-driven launches            | "Avoid launch-week deploy surprises."                              |
| 7   | Two-person founder teams with one technical lead              | Solo SaaS             | Technical lead owns every operational detail     | "Give the non-infra founder a readable release state."             |
| 8   | Productized-service agencies                                  | Agency Pod            | Repeated delivery across similar repos           | "Standardize the release path across client projects."             |
| 9   | Small web studios shipping on Vercel plus custom backends     | Agency Pod            | Mixed hosting creates release drift              | "Bring frontend and backend deploy state into one flow."           |
| 10  | Shopify or headless-commerce agencies with custom services    | Agency Pod            | Client regressions are costly                    | "Add gates around client-facing changes."                          |
| 11  | Fractional CTO collectives                                    | Agency Pod            | Own delivery quality across many startups        | "A lightweight deploy playbook for every portfolio repo."          |
| 12  | Contractor pods using AI coding assistants                    | Agency Pod            | Need reviewable agent output                     | "Make agent-created changes auditable before handoff."             |
| 13  | Small maintenance teams for local-business SaaS               | Agency Pod            | Low tolerance for downtime, limited infra budget | "Replace tribal deploy knowledge with visible release state."      |
| 14  | No-code plus custom-code agencies                             | Agency Pod            | Custom services lack consistent operations       | "Cover the code-backed parts of client stacks."                    |
| 15  | Seed-stage startups before first infra hire                   | Infra-Curious Startup | Pain exists before dedicated ownership           | "Install release discipline before infra becomes a full-time job." |
| 16  | Startups adding their second or third backend service         | Infra-Curious Startup | Service sprawl creates deploy ambiguity          | "Create one release spine while architecture is still small."      |
| 17  | Teams preparing for enterprise pilots                         | Infra-Curious Startup | Need confidence and evidence around releases     | "Show build, deploy, and approval state for pilot changes."        |
| 18  | Teams moving from manual VPS deploys to containerized deploys | Infra-Curious Startup | Migration moment creates urgency                 | "Use ForgeGraph as the migration control plane."                   |
| 19  | Developer-tool startups dogfooding AI agents                  | Infra-Curious Startup | Will understand agent workflow pain              | "Trust but verify agent delivery through release gates."           |
| 20  | Cloudflare/Fly.io/Render community builders                   | Infra-Curious Startup | Already comfortable with developer infra         | "Add deploy visibility without changing your whole hosting stack." |

## Outreach Angles By Segment

Solo SaaS:

- "Your next deploy should be boring even if the code came from an agent."
- "Clone it, connect one repo, and know whether the change built, deployed, and stayed healthy."
- "For founders who do not have a platform team but still need production confidence."

Agency pod:

- "Make client deploys repeatable across projects without adding another full platform."
- "Give the pod a shared release state instead of asking one senior dev what happened."
- "A lightweight quality gate for contractor and agent-assisted changes."

Infra-curious startup:

- "Release discipline before the first platform hire."
- "One place to see revisions, gates, environments, and production readiness."
- "Start with a single service and use ICP fit to decide what infrastructure belongs on the roadmap."

## First-Value Path

Hypothesis: a qualified developer should reach the first "aha" in under 30 minutes.

| Step              | Target time   | User action                                                          | Product response                                         | Aha signal                                                |
| ----------------- | ------------- | -------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Clone/install     | 0-7 minutes   | Clone repo, install dependencies, configure env                      | CLI or local app starts with clear missing-prereq checks | "I can run this against my repo without a sales call."    |
| Connect repo      | 7-12 minutes  | Select one active service repo                                       | ForgeGraph identifies repo, branch, and deploy metadata  | "It understands the thing I ship."                        |
| First deploy path | 12-22 minutes | Run or register build/deploy command for a safe environment          | Build/deploy state appears in the pipeline               | "I can see release progress without tailing random logs." |
| Reviewable result | 22-30 minutes | Inspect revision, gates, deploy status, and failure/rollback options | Pipeline shows what changed and whether it is safe       | "This could replace my manual deploy checklist."          |

Validation plan:

- Run five founder or agency onboarding calls where the evaluator shares screen from clone to first deploy signal.
- Measure time to first visible repo, first build/deploy event, and first user-stated confidence moment.
- Record every prerequisite failure as either documentation, product detection, or unsupported-hosting work.
- Consider the path validated when 4 of 5 qualified evaluators reach a meaningful deploy or deploy-simulation signal within 30 minutes.
- Consider urgency validated when at least 3 of 5 ask to use it on a second repo or next production change.

## Roadmap Prioritization From ICP Fit

Use this checklist to bias PM and engineering decisions:

- If a feature reduces clone-to-first-signal time, prioritize it for all three segments.
- If a feature improves agent-change trust, prioritize it for solo SaaS and agency pods first.
- If a feature standardizes multi-repo client delivery, prioritize it for agency pods when it does not slow solo onboarding.
- If a feature adds enterprise controls before technical activation, defer it unless required for a high-fit startup pilot.
- If a hosting integration covers Vercel, Fly.io, Render, Railway, Hetzner, Docker, or VPS scripts, prefer it over large-platform-only integrations.
- If a feature needs a platform engineer to understand or operate, treat that as a warning sign for the initial ICP.

## Open Validation Questions

- Which hosting surface produces the fastest first deploy signal for the first ten evaluators?
- Does "agent trust" or "deploy predictability" create the stronger pull in outbound copy?
- Is 30 minutes the right activation promise, or does the ICP expect a 10-15 minute proof?
- Which segment is most likely to contribute fixes, docs, or integration examples back to the OSS repo?
