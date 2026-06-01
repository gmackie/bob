# ForgeGraph Competitive Battlecard

**Issue:** GMA-53
**Document date:** 2026-06-01
**Status:** v0 draft

## Positioning Summary

ForgeGraph should be framed as a small-team delivery control plane: work items, agent execution, build/deploy evidence, and app runtime state in one workflow. The wedge is not "cheaper Heroku" or "simpler Kubernetes" in isolation. The wedge is that deployment state and work state are connected, so contributors can answer what changed, what ran, what shipped, and what needs attention without building a platform team first.

Prototype honesty: v0 should not claim broad ecosystem maturity, enterprise compliance, or full Kubernetes replacement. It can claim a focused app/work-item loop, self-hostable deployment posture, and a path to managed operations.

## Competitive Matrix

| Alternative               | Target user                                                          | Deploy model                                                         | OSS core?                                  | Pricing shape                                                                                                                                    | Obvious weakness                                                                                             |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Heroku                    | Developers and teams that want mature PaaS defaults                  | Git/Docker deploys to managed dynos                                  | No                                         | Dyno/add-on monthly tiers; Eco dynos listed at $5/month, larger private/shield dynos scale much higher[^heroku-pricing]                          | Easy path can become expensive; platform state is separate from work-item and agent evidence                 |
| Render                    | Startups wanting modern managed PaaS with preview environments       | Managed services, workers, cron, Postgres, IaC                       | No                                         | Per-service compute, storage, bandwidth, team tiers; compute billed prorated to the second[^render-pricing]                                      | Strong app hosting, but not a work-item or agent-delivery system                                             |
| Railway                   | Indie hackers and small teams optimizing for fast project deploys    | Managed project/services model                                       | No                                         | Base subscription plus resource usage; Free, $5 Hobby, $20 Pro, custom Enterprise[^railway-plans]                                                | Usage/resource billing can be harder to forecast; delivery process still lives outside Railway               |
| Fly.io                    | Developers needing global lightweight compute close to users         | Machines/apps on Fly infrastructure                                  | No                                         | Resource and egress usage; outbound data transfer billed by region group[^fly-pricing]                                                           | Powerful runtime primitives, but requires more platform understanding than simple PaaS                       |
| DigitalOcean App Platform | Developers wanting a managed path above Droplets                     | Managed app platform with containers and static sites                | No                                         | Static-site free tier, paid containers, bandwidth overage at $0.02/GiB[^do-app-platform]                                                         | Less opinionated about CI evidence, agent runs, and work-item lifecycle                                      |
| VPS plus scripts          | Cost-sensitive technical users comfortable owning servers            | User-owned VPS, Docker/systemd/scripts                               | Usually custom scripts, not a product core | VM monthly cap/hourly billing; DigitalOcean Droplets start at $4/month and are unmanaged[^do-droplets]                                           | Cheapest path hides operational toil: patching, rollback, certs, secrets, monitoring, logs                   |
| Coolify                   | Self-hosters wanting a Heroku-like dashboard on their own servers    | Self-hosted or Coolify Cloud control plane connected to user servers | Yes                                        | Self-hosted free; Cloud starts at $5/month plus $3/month per extra server[^coolify-pricing]                                                      | Good self-hosted PaaS, but does not own delivery/work-item semantics                                         |
| Dokploy                   | Self-hosters wanting simple Docker and Traefik app management        | Self-hosted Docker/Traefik platform                                  | Yes                                        | Free self-hosted; user pays infrastructure                                                                                                       | Deployment UI, not a broader delivery control plane; maturity and ops depth vary by community[^dokploy-docs] |
| K3s/k0s/Kubernetes        | Platform teams and infra-heavy users needing orchestration standards | Kubernetes distro on owned or cloud infrastructure                   | Yes                                        | Software free; pay infrastructure and operations. Kubernetes is open source under CNCF[^kubernetes-docs]; k0s is 100% open source and free[^k0s] | Correct primitive for platform teams, but too much surface area for solo/small-team app delivery             |

## Feature Snapshot

As of 2026-06-01. This is a GTM feature snapshot, not a benchmark.

| Capability                | ForgeGraph v0                                                                                        | Heroku                                       | Railway                                                                              | Coolify                                            | K3s/k0s/Kubernetes                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| App deploys from repo     | Planned/core product direction via ForgeGraph app/repo ownership                                     | Yes, Git and Docker deploys[^heroku-pricing] | Yes, project/service deploy model[^railway-plans]                                    | Yes, self-hosted deployments[^coolify-pricing]     | Yes, but via manifests/controllers, not app-first UX[^kubernetes-docs] |
| Managed runtime           | Prototype/limited; honest gap until managed runners harden                                           | Yes                                          | Yes                                                                                  | Control plane optional; apps run on user's servers | No by default; user or provider operates the cluster                   |
| Self-host path            | Yes, current direction centers owned infrastructure and ForgeGraph CLI/onboarding                    | No                                           | No                                                                                   | Yes                                                | Yes                                                                    |
| OSS core                  | TBD/not positioned as public OSS core yet                                                            | No                                           | No                                                                                   | Yes                                                | Yes                                                                    |
| Work-item to deploy trace | Core differentiator: work items, agent runs, builds, deployments, and artifacts are modeled together | No native work-item model                    | No native work-item model                                                            | No native work-item model                          | No native work-item model                                              |
| Agent execution evidence  | Core differentiator through Bob/ForgeGraph integration                                               | No                                           | Partial adjacent agent features, billed separately in Railway docs[^railway-pricing] | No                                                 | No                                                                     |
| Platform maturity         | Prototype                                                                                            | Mature                                       | Mature                                                                               | Active self-hosted product                         | Very mature ecosystem, high complexity                                 |

## Named Battlecards

### Heroku

**Win**

- ForgeGraph connects delivery state to work-item and agent evidence; Heroku is excellent at app hosting but does not know why a change exists or what agent produced it.
- ForgeGraph can speak to buyers who want ownership of infra posture instead of putting every runtime concern behind a closed PaaS.

**Lose**

- Heroku wins today on proven reliability, add-on marketplace, documentation depth, enterprise/compliance posture, and default platform operations.
- ForgeGraph v0 should not compete on "zero ops" until managed runners and security-update ownership are explicit.

**Tie**

- Both can offer app-centric deployment primitives. The tie-breaker is whether the buyer values mature PaaS convenience or connected delivery evidence.

### Coolify

**Win**

- ForgeGraph is stronger when the buyer cares about the full delivery loop: work item, agent run, artifacts, build/deploy gate, and runtime state.
- Coolify is a strong self-hosted PaaS, but ForgeGraph can differentiate by becoming the system of record for software delivery, not only deployment.

**Lose**

- Coolify has a clear public self-hosted/open-source story and a simple pricing story today: self-hosted free, cloud control plane priced per connected server[^coolify-pricing].
- If the buyer only wants "Heroku on my VPS," Coolify is easier to explain.

**Tie**

- Both appeal to teams that want to use their own servers and avoid fully managed PaaS lock-in.

### K3s/k0s/Kubernetes

**Win**

- ForgeGraph should win with solo developers and small teams that do not want to become cluster operators just to ship apps.
- ForgeGraph can sit closer to product delivery questions: what work item changed, what agent ran, what shipped, and what failed.

**Lose**

- Kubernetes wins when the buyer already needs standard orchestration APIs, large ecosystem integrations, multi-team platform governance, custom networking, or workload portability at infra scale.
- ForgeGraph v0 should not claim to replace Kubernetes for complex clusters.

**Tie**

- Both can run on owned infrastructure. Kubernetes is the lower-level substrate; ForgeGraph is the app/workflow control plane.

## Objection Handling

**"Why not Kubernetes?"**

Use Kubernetes when you need a platform API and have the operating capacity to own it. ForgeGraph is for teams whose main problem is shipping and understanding app changes, not designing cluster architecture. We keep the conversation at the work-item, build, deploy, and runtime-state level. Kubernetes can still be a substrate later; it should not be the first product surface for a small team.

**"Why not managed PaaS?"**

Managed PaaS is the right answer when the buyer values mature zero-ops hosting above control and delivery traceability. ForgeGraph is for buyers who want the deployment system to know the work: which issue, which agent run, which artifacts, which gates, and which environment. Be honest that mature PaaS providers win on operational polish today.

**"Who maintains security updates?"**

Split the answer by layer. App dependency updates remain the application owner's responsibility. In ForgeGraph-managed runtime paths, ForgeGraph should own base runtime images, deployment templates, and platform component updates. In self-hosted/BYO-server paths, the customer still owns host OS patching unless they buy or enable a managed runner/update service. Do not imply v0 magically removes VPS maintenance.

## Source Notes

[^heroku-pricing]: Heroku pricing, accessed 2026-06-01: https://www.heroku.com/pricing/

[^render-pricing]: Render pricing, accessed 2026-06-01: https://render.com/pricing

[^railway-pricing]: Railway pricing overview, accessed 2026-06-01: https://docs.railway.com/pricing

[^railway-plans]: Railway pricing plans, last updated 2026-05-29 and accessed 2026-06-01: https://docs.railway.com/pricing/plans

[^fly-pricing]: Fly.io resource pricing, accessed 2026-06-01: https://fly.io/docs/about/pricing/

[^do-app-platform]: DigitalOcean App Platform pricing, accessed 2026-06-01: https://www.digitalocean.com/pricing/app-platform

[^do-droplets]: DigitalOcean Droplet pricing, accessed 2026-06-01: https://www.digitalocean.com/pricing/droplets

[^coolify-pricing]: Coolify pricing, accessed 2026-06-01: https://coolify.io/pricing/

[^dokploy-docs]: Dokploy documentation, accessed 2026-06-01: https://docs.dokploy.com/docs/core

[^kubernetes-docs]: Kubernetes documentation, accessed 2026-06-01: https://kubernetes.io/docs/home/

[^k0s]: k0s project homepage, accessed 2026-06-01: https://k0sproject.io/
