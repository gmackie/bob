# ForgeGraph Market Positioning

Date: 2026-05-31
Status: Prototype GTM positioning

## One-Liner

ForgeGraph is indie DevOps for small teams that want Heroku-like release flow on their own infrastructure, without handing every deploy and idle service to a rented cloud platform.

## Paragraph Positioning

ForgeGraph is for indie hackers and small teams who are comfortable owning a VPS, lab box, or small cluster, but do not want to rebuild the same deploy pipeline, work tracking, review gates, and release evidence for every project. It sits between "just SSH and scripts" and a full commercial PaaS: a self-hostable control plane that links work items, code changes, CI, environments, secrets, deployments, and operational facts into one delivery graph. At the prototype stage, the strongest promise is not enterprise platform completeness; it is a sharper operating model for founders escaping cloud rent who still want disciplined shipping.

## Category Choice

Use a hybrid category: **indie DevOps for self-hosted PaaS workflows**.

"Self-hosted PaaS" is legible, but by itself it invites a feature checklist fight against CapRover, Dokku, Coolify, Railway, Render, and Heroku. ForgeGraph should not lead as another app launcher. "Indie DevOps" names the actual wedge: small teams that own infrastructure, ship many small apps, care about cost control, and need release discipline without a platform team. The hybrid phrase keeps the familiar PaaS reference while making the buyer and use case more specific.

## Differentiation Pillars

### 1. Delivery graph, not just deploy buttons

Heroku-style PaaS products and many self-hosted launchers focus on "push code, get a running app." ForgeGraph's distinct angle is that the deploy is only one node in a graph: work item, branch or changeset, PR, CI evidence, staging state, production promotion, and monitoring facts belong together.

Shipped in this repo: Bob treats ForgeGraph as the canonical work-item and delivery-state authority, with API/client paths for work items, revisions, builds, deployments, run events, secrets, and status mapping.

Roadmap: make the graph the primary public product surface so a founder can answer "what changed, why, who approved it, what shipped, and what broke" from one place.

### 2. Self-hosting without pretending ops disappears

Dokku and CapRover are strong when the user wants lightweight self-hosted app deployment. Fly, Render, Railway, and Heroku are strong when the user wants someone else to run the substrate. ForgeGraph positions between those: bring your own machine or cluster, keep the costs and data boundary close, but use a structured control plane for promotion, secrets, environment state, and audit trails.

Shipped in this repo: ForgeGraph integration is already modeled around projects/apps, deploy environments, secrets, CI/build/deploy status, and Bob-side execution reporting.

Roadmap: tighten installation and day-two operations until the first useful path feels closer to "connect repo, define app, ship" than hand-assembling a platform.

### 3. Built for agent-era shipping loops

Generic PaaS tools do not usually know whether work was planned by an agent, executed by an agent, reviewed by a human, or reopened by staging feedback. ForgeGraph's graph model gives Bob and other agents a place to report work, attach artifacts, request transitions, and let policy decide whether to proceed.

Shipped in this repo: Bob can act as a trusted operator against ForgeGraph concepts, reporting execution lifecycle events and connecting agent work back to work items and delivery state.

Roadmap: expand policy, approvals, and artifact review so agent-generated changes can move through an auditable release loop instead of landing as disconnected diffs.

## Near Alternatives

- **Heroku / Render / Railway / Fly patterns:** easier hosted deployment, but higher platform rent and less ownership of substrate. ForgeGraph trades some convenience for cost control, self-hosting, and delivery graph visibility.
- **CapRover / Dokku:** mature self-hosted app deployment paths, but narrower product models around app launch and runtime management. ForgeGraph should compete on release context, work graph, agent reporting, and promotion policy.
- **Kubernetes glue:** powerful for teams that already have platform skills, but too much undifferentiated setup for many indie teams. ForgeGraph should avoid selling raw orchestration and instead sell the workflow above the machines.

## Who ForgeGraph Is Not For

- Teams that want a fully managed cloud where infrastructure ownership is someone else's problem.
- Enterprises needing SOC 2 procurement, SSO, multi-region compliance controls, and mature support processes today.
- Platform teams that already have a polished Kubernetes/GitOps/internal-developer-platform stack.
- Non-technical founders who do not want to touch repositories, servers, deploy logs, or secrets.
- Projects whose only need is a static site or a single toy app with no release discipline.

## README Hero Copy

**ForgeGraph: indie DevOps for self-hosted PaaS workflows.**

Run a Heroku-like release flow on infrastructure you own. ForgeGraph links work items, code changes, CI, environments, secrets, deploys, and operational facts into one delivery graph for founders and small teams escaping cloud rent.

## 60-Second Founder Pitch

ForgeGraph is indie DevOps for small teams that want the convenience of a PaaS without paying forever for every idle service. If you are an indie hacker with a VPS, a lab box, or a small cluster, you can run your own infrastructure, but the hard part is keeping every project disciplined: what work item caused this change, what PR shipped, what CI passed, what environment is live, what secret changed, and what happens when staging fails.

ForgeGraph turns that into a delivery graph. It is not trying to be enterprise Kubernetes glue, and it is not pretending self-hosting removes ops. The goal is a practical control plane for founders: track the work, attach the evidence, promote through environments, and let agents or humans report progress into the same system. The prototype already has the core Bob integration shape around work items, revisions, builds, deployments, secrets, and run events. The next milestone is making that feel like the default way an indie team ships on machines they control.

## Site Copy Blocks

### Hero

**Indie DevOps for self-hosted PaaS workflows**

ForgeGraph gives small teams a Heroku-like release flow on infrastructure they own, with work items, changes, CI, secrets, deploys, and operations tied into one delivery graph.

### Short Value Prop

Own the machines. Keep the release discipline. Stop rebuilding deploy scripts, promotion gates, and status tracking for every project.

### Prototype Honesty

ForgeGraph is in prototype stage. The current product direction is sharp enough for early users who want to help shape the self-hosted delivery workflow, not for teams expecting a mature hosted PaaS replacement today.
