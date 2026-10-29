# ReqIF-backed requirements integration — Bob plan

Status: proposed (2026-09-23).

Companion plan: `gmackie/linear-clone/docs/plans/2026-09-23-reqif-requirements-graph.md`.

## Goal

Teach Bob to consume and act on a canonical requirements/trace graph owned initially by linear-clone, so autonomous planning and execution remain linked to the system intent they are meant to satisfy.

Bob should not become the canonical human requirements-management UI and should not persist a second competing requirements graph.

Instead Bob should:

- read requirements linked to work items/projects;
- traverse upstream/downstream requirement relations;
- include trace-aware requirement context in planning and execution prompts;
- derive plan/task obligations from requirements and their verification expectations;
- write back implementation/evidence traces from runs, PRs, tests, reviews, and artifacts;
- compute/use requirement coverage for review and completion gates;
- detect requirement changes that invalidate prior plans/evidence;
- remain compatible with external planning providers while using richer capabilities when the provider is linear-clone;
- preserve a clean extraction seam for a future `@forgegraph/requirements` package.

## Current-state terminology collision

Bob already has a `requirements` table and `workItem.requirement.*` API.

Today those records are work-item-local checklist requirements:

~~~text
category: data | api | ui | infra | test | other
description
status: pending | in_progress | done
linkedTaskId
sortOrder
~~~

They answer roughly:

> What local implementation expectations/checklist items belong to this WorkItem?

They are not the canonical system/product Requirements imported from ReqIF.

Before integrating the new graph, rename/namespace this concept in code/API/UI.

Suggested names:

~~~text
WorkItemCriterion
WorkItemRequirement
ImplementationCriterion
WorkItemChecklistItem
~~~

Long-term recommendation: use `ImplementationCriterion` or `WorkItemCriterion` internally, and reserve unqualified `Requirement` for the canonical external/system-level concept.

## Ownership boundary

Initial architecture:

~~~text
linear-clone
  Requirement Graph
  Specification hierarchy
  ReqIF adapter
  Trace graph
  impact/coverage APIs

Bob
  WorkItems
  plans/checklists
  agents/runs
  PR/review lifecycle
  verification/evidence production
~~~

Bob should reference canonical Requirement IDs/URIs and cache snapshots only for execution resilience/context reproducibility.

Bob must not silently fork/modify authoritative external requirements.

## Provider architecture

Bob already has a `PlanningProvider` abstraction for task/issue lifecycle.

Do not overload that interface with the entire requirements domain because generic Linear.com planning providers will not support it.

Add a separate optional capability abstraction, e.g.:

~~~ts
interface RequirementsProvider {
  getRequirement(id: string): Promise<RequirementSnapshot | null>
  listForWorkItem(ref: WorkItemRef): Promise<RequirementContext>
  getTraceNeighborhood(id: string, options?: ...): Promise<TraceGraph>
  getCoverage(id: string): Promise<RequirementCoverage>
  getImpact(id: string): Promise<RequirementImpact>
  createTrace(input: TraceCreateInput): Promise<TraceRecord>
  createEvidenceTrace(input: EvidenceTraceInput): Promise<TraceRecord>
}
~~~

Provider resolution:

~~~text
planning provider = internal
  -> optional InternalRequirementsProvider

planning provider = linear / tasks.gmac.io
  -> LinearPlanningProvider for issue API
  -> ForgeRequirementsProvider when native requirements capability is discovered

planning provider = real Linear.com
  -> no requirements capability unless separately configured
~~~

Keep planning and requirements capabilities composable.

## Capability discovery

Bob needs a safe way to know that a Linear-compatible endpoint is actually linear-clone with Forge extensions.

Prefer explicit capability discovery rather than assuming based on hostname.

Candidate endpoint:

~~~text
GET /.well-known/forge-requirements
~~~

Example:

~~~json
{
  "version": "1",
  "apiBase": "/api/v1/requirements",
  "trace": true,
  "coverage": true,
  "impact": true,
  "reqif": { "import": true, "export": false }
}
~~~

Bob may cache this per workspace/provider with conservative expiry.

## Requirement context model

Bob should fetch a structured requirement bundle for every work item it plans or executes.

Candidate shape:

~~~ts
RequirementContext {
  direct: RequirementSnapshot[]
  upstream: RequirementSnapshot[]
  downstream: RequirementSnapshot[]
  constraints: RequirementSnapshot[]
  verification: RequirementSnapshot[]
  traces: TraceRecord[]
  coverage: RequirementCoverage[]
  generatedAgainst: RequirementGraphRevision
}
~~~

Do not dump the entire requirement repository into the model context.

Context traversal should be bounded and relation-aware.

Default traversal might include:

~~~text
direct requirements linked to issue/work item
  + parent/refined-from requirements
  + constraints
  + verification requirements
  + closely related changed requirements
~~~

Exclude broad unrelated descendants unless explicitly requested.

## Requirement-aware planning

Planning should convert Requirement context into explicit obligations.

Example:

~~~text
REQ-AUTH-042
  Sessions revoked within 60 seconds

REQ-AUTH-043
  Revocation applies to every active device session

VREQ-AUTH-007
  Verify revocation latency under load
~~~

Planner output:

~~~text
Task 1
  implements: REQ-AUTH-042, REQ-AUTH-043

Task 2
  verifies: VREQ-AUTH-007
  verifies: REQ-AUTH-042
~~~

Plan/task records should retain requirement trace metadata rather than relying only on prompt text.

## Plan and checklist integration

Bob already has:

~~~text
PlanDraft
PlanTaskItem
gate
acceptanceCriteria
dependencies
~~~

Extend plan items with references such as:

~~~text
implementsRequirementIds[]
verifiesRequirementIds[]
constrainingRequirementIds[]
traceIntent[]
~~~

Do not duplicate requirement bodies into plan records; keep snapshot/hash metadata only when required for reproducibility.

Plan gates can use requirement obligations:

~~~text
implementation gate
  -> every implements trace created

verification gate
  -> required verification evidence exists

review gate
  -> no linked requirement remains uncovered/stale
~~~

## Execution snapshot / reproducibility

Every TaskRun should know which requirement graph revision/context it was generated against.

Persist execution-time snapshots:

~~~text
requirementGraphRevision
requirementIds[]
requirementContentHashes
traceContextHash
~~~

This allows Bob to answer:

> Which requirements did the agent actually see when it produced this PR?

If a requirement changes later, Bob can distinguish:

~~~text
run was correct against old requirement set
current requirement set has changed
reverification/replanning may be required
~~~

## Trace write-back

Bob should become a major producer of lifecycle traces.

On planning:

~~~text
Requirement --plannedBy--> PlanItem
~~~

On dispatch:

~~~text
Requirement --implementedBy--> TaskRun
~~~

On PR creation/merge:

~~~text
Requirement --implementedBy--> PullRequest / Revision
~~~

On test/verification:

~~~text
Requirement --verifiedBy--> Test/VerificationArtifact
~~~

On review:

~~~text
Requirement --evidencedBy--> ReviewArtifact
~~~

Trace write-back should be idempotent using stable tuple/idempotency keys.

Bob should never infer `satisfied` solely because a task reached `done`; coverage should derive from explicit traces and evidence.

## Artifact integration

Bob already stores work-item/run artifacts including:

~~~text
pr
verification
build
test_report
doc
planning_doc
code_review
deliverable
~~~

These are natural evidence targets.

Extend artifact metadata with trace references rather than creating separate duplicate evidence objects.

Example:

~~~json
{
  "artifactType": "test_report",
  "artifactRole": "verification",
  "requirements": ["REQ-AUTH-042", "VREQ-AUTH-007"],
  "evidenceKind": "automated_test"
}
~~~

After artifact persistence, emit trace links back to linear-clone.

## Requirement-aware agent context

Augment Bob's execution prompt/context with a compact structured section.

Suggested form:

~~~text
Requirements in scope

[REQ-AUTH-042] Sessions shall be revoked within 60s.
  relation: direct
  status: approved
  verification: VREQ-AUTH-007

[SEC-019] Revocation must apply across all active devices.
  relation: constrains

Requirement changes since prior run
  none
~~~

Agents should receive stable IDs in addition to prose so findings and artifacts can reference exact requirements.

## Requirement findings

Bob should be able to analyze requirement quality without silently editing authoritative requirements.

Add findings/proposals such as:

~~~text
ambiguous
non-verifiable
contradictory
duplicate
missing verification
unrealized
stale evidence
orphaned
implementation drift
~~~

Suggested model:

~~~ts
RequirementFinding {
  id
  requirementId
  kind
  severity
  description
  evidenceRefs[]
  proposedChange?
  status
}
~~~

Write findings back through the native requirements API as reviewable objects/comments rather than mutating the requirement automatically.

## Coverage-aware review

Bob's review phase should include requirement coverage.

Example review summary:

~~~text
Requirements
  REQ-42 implementation: covered
  REQ-42 verification: covered
  REQ-43 implementation: covered
  REQ-43 verification: missing

Result:
  changes_requested
  reason: REQ-43 lacks required verification evidence
~~~

Coverage is only one gate input; existing code quality/test/reviewer gates remain.

## Requirement-change handling

linear-clone should publish or expose requirement change events/diffs.

Bob should react by traversing impact:

~~~text
Requirement changed
  -> linked open WorkItems
  -> active PlanItems
  -> recent completed Runs/PRs
  -> verification evidence
~~~

Classify impact:

~~~text
no_action
context_refresh
reverify
replan
implementation_change
human_review_required
~~~

Do not automatically reopen/modify work without configurable policy.

## Autonomous maintenance loop

Long-term flow:

~~~text
ReqIF/OSLC requirement delta
        ↓
linear-clone Requirement Graph diff
        ↓
impact set
        ↓
Bob proposes WorkItems / replans existing work
        ↓
agents implement
        ↓
tests/review produce evidence
        ↓
coverage returns to satisfied/current
~~~

This is the real payoff: requirement-driven autonomous maintenance rather than static import.

## Interaction with ConceptIR / Forge

Bob should include Forge semantic traces when available:

~~~text
Requirement
  -> ConceptIR Process
  -> Contract/Invariant
  -> Policy
  -> Entity/Fact
~~~

This enables higher-quality planning:

~~~text
REQ changes
  -> affected ConceptIR semantic IDs
  -> affected realization/code areas
  -> affected tests/evidence
~~~

Bob should consume these links; forgec remains responsible for ConceptIR/L1 conformance.

## Current Bob `requirements` migration

Do not abruptly replace the current table/API.

Suggested path:

### Step A

Rename schema/API types first while preserving compatibility aliases:

~~~text
requirements table
  -> work_item_criteria (eventual migration)

workItem.requirement.*
  -> workItem.criterion.*
~~~

Keep old RPC aliases deprecated for one release window if useful.

### Step B

Add canonical Requirement references from WorkItem:

~~~text
WorkItemRequirementLink
  workItemId
  requirementId
  relation
  sourceProvider
~~~

These are references to linear-clone, not duplicate canonical requirements.

### Step C

Move planning logic from local checklist rows toward canonical requirement context where projects have a RequirementsProvider.

Local criteria continue to exist for implementation-specific expectations not appropriate as system requirements.

## Phasing

### Phase 0 — terminology + provider seam

- rename/namespace Bob's current local `Requirement` concept;
- define `RequirementsProvider` interface;
- add capability discovery;
- define canonical snapshots/trace references;
- no behavior change yet.

### Phase 1 — read-only requirement context

- linear-clone provider implementation;
- fetch direct/upstream/constraint/verification requirements;
- attach requirement context to WorkItem detail and planning sessions;
- store graph revision/hash on planning session/run;
- show requirements in Bob UI.

Exit: agents can work with authoritative requirement context without write-back.

### Phase 2 — requirement-aware planning

- planners label draft/checklist items with implements/verifies/constrains refs;
- persist trace intent;
- add requirement obligations to gates;
- detect requirements with no planned coverage.

### Phase 3 — trace write-back

- create requirement -> plan/task/run/PR traces;
- link artifacts/tests/reviews as evidence;
- idempotent write-back;
- trace status visible in run/review UI.

### Phase 4 — coverage-aware review

- fetch computed coverage from linear-clone;
- gate completion/review when configured requirements lack evidence;
- report gaps as Bob findings;
- preserve human override with explicit audit.

### Phase 5 — requirement delta / impact

- subscribe/poll requirement changes;
- invalidate stale execution context;
- compute impacted work/runs/evidence;
- propose reverify/replan/new WorkItems.

### Phase 6 — quality analysis

- ambiguity/verifiability/contradiction/orphan analysis;
- proposed requirement improvements;
- no silent edits;
- review workflow in linear-clone.

### Phase 7 — future shared package

Once semantics stabilize, move pure contracts/algorithms into:

~~~text
@forgegraph/requirements
~~~

Bob imports:

- RequirementSnapshot schemas;
- relation vocabulary;
- trace types;
- coverage types;
- ReqIF identifiers/profile types where needed;
- semantic diff/impact helpers.

Bob should not import persistence or linear-clone UI code.

## API/client changes

Add a requirements client separate from `PlanningClient`/`WorkItemsClient`:

~~~ts
bob.requirements.getContext(...)
bob.requirements.getRequirement(...)
bob.requirements.getCoverage(...)
bob.requirements.getImpact(...)
bob.requirements.trace.create(...)
bob.requirements.finding.create(...)
~~~

Whether this is surfaced directly through the Bob client or only used server-side can be decided per phase.

## Failure behavior

Requirements integration must degrade safely.

If requirements provider is unavailable:

- do not lose task execution state;
- mark requirement context as unavailable/stale;
- do not fabricate coverage;
- block only when project policy explicitly requires authoritative requirement coverage;
- retry trace write-back through an outbox/idempotent journal.

Trace/evidence writes should use durable retry semantics; successful code execution must not be repeated merely because trace synchronization failed.

## Security

Requirement data may be more sensitive than ordinary issue metadata.

Provider calls must remain workspace-scoped and principal-aware.

Bob should preserve source authorization decisions; do not copy broad requirement datasets into local caches beyond what the run needs.

Log/trace output should reference IDs and avoid dumping classified requirement bodies by default.

Future `@forgegraph/requirements` must carry classification/purpose metadata where integrations provide it.

## Testing

### Unit

- bounded trace traversal;
- requirement context selection;
- relation canonicalization;
- coverage gate decisions;
- impact classification;
- idempotency keys;
- stale-context detection.

### Integration

- Bob -> linear-clone requirement context;
- planner retains requirement IDs;
- trace write-back;
- evidence attachment;
- provider outage/outbox recovery;
- requirement changed after run -> stale coverage;
- real Linear.com provider gracefully reports no requirement capability.

### End-to-end

Scenario:

~~~text
ReqIF import
  -> requirement linked to Issue
  -> Bob plans tasks
  -> agent implements
  -> PR + test report
  -> traces/evidence written
  -> review checks coverage
  -> requirement coverage current
~~~

Then mutate the requirement and verify Bob identifies affected evidence/work.

## Acceptance criteria

- [ ] Bob's existing work-item-local requirement concept is clearly renamed/namespaced.
- [ ] RequirementsProvider is separate from PlanningProvider.
- [ ] Bob can discover linear-clone requirements capability explicitly.
- [ ] Planning/execution context includes bounded authoritative requirement context.
- [ ] Planning artifacts retain requirement trace intent.
- [ ] TaskRun records the requirement graph revision/context it used.
- [ ] Bob writes idempotent traces for plan/task/run/PR/test/review evidence.
- [ ] Requirement coverage can participate in review/completion gates.
- [ ] Provider outage cannot cause work to be incorrectly marked covered/satisfied.
- [ ] Requirement deltas can mark prior context/evidence stale and produce impact recommendations.
- [ ] Bob can emit findings/proposals without silently editing authoritative requirements.
- [ ] Real Linear.com planning integration remains functional without requirements capability.
- [ ] Shared types/algorithms are structured for later extraction into `@forgegraph/requirements`.

## End state

~~~text
Requirement intent
      ↓
linear-clone
 human planning + trace graph
      ↓
     Bob
 plan / execute / review
      ↓
PR + tests + evidence
      ↓
trace write-back
      ↓
Requirement coverage
      ↓
requirement delta
      ↺ autonomous impact / maintenance
~~~

Bob becomes requirement-aware without becoming the requirements source of truth.