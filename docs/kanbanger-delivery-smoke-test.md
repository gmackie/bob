# Bob → Kanbanger delivery smoke test (BOB-37)

Operator checklist for the controlled production integration test authorized by
Graham. These are checks to perform; this document does not establish successful
production verification. Keep the change documentation-only and use the existing
integration without changing runtime code, configuration, or credentials.

- [ ] **Import:** Confirm Kanbanger issue `BOB-37` maps to one Bob work item in
  the intended workspace/project. Check `externalProvider: "linear"`, the issue
  UUID in `externalId`, and `sourceMetadata.trackerIdentifier: "BOB-37"`.
  Entry points: [`syncLinearProjects`](../packages/bob/src/api/src/handlers/linearSetup.ts)
  and [`processLinearWebhook`](../packages/bob/src/api/src/services/webhooks/processLinearWebhook.ts).
- [ ] **Execution:** Confirm the queued item is claimed and has an associated
  execution/session. [`autoDrainBacklog`](../packages/bob/src/api/src/handlers/autoDrain.ts)
  dispatches work using the tracker identifier and calls
  [`mirrorWorkItemEvent`](../packages/bob/src/api/src/services/tracker/trackerMirror.ts)
  with `claimed` to mirror In Progress. Check the run's result and documentation
  diff rather than treating a claim as completed work.
- [ ] **PR delivery:** Confirm the pushed branch
  `bob/BOB-37-integration-smoke-test-document-bob-to-kanbanger-p` has an open PR
  in ForgeGraph/Forgejo targeting the repository's default branch. Include
  `BOB-37` in the PR title and `Refs: BOB-37` as a commit trailer. Confirm Bob
  records the PR URL and links it to the run/work item.
  [`reconcileTrackerPullRequests`](../packages/bob/src/api/src/handlers/reconcileTrackerPullRequests.ts)
  finds an existing PR or creates one from a finished run's pushed branch,
  records it, and announces a non-draft open PR.
- [ ] **Ready for review:** Check the Kanbanger issue for the PR-opened fact and
  a review request with a useful summary, test plan, and PR/commit links.
  [`announceReadyForReview`](../packages/bob/src/api/src/handlers/autoMergeReview.ts)
  calls `mirrorWorkItemEvent`; `reportToKanbanger` sends reports built by
  [`buildPrFact` / `buildReviewRequest` / `postDeliveryReport`](../packages/bob/src/api/src/services/tracker/kanbangerDelivery.ts)
  to `POST /api/workspaces/{workspaceId}/delivery`. Confirm acceptance and the
  review revision, not just a review-column move: fallback GraphQL updates can
  move the issue without an accepted report. A `409` progress-gate blocker keeps
  work in progress and records `sourceMetadata.deliveryBlocked`; investigate it
  before claiming readiness.
- [ ] **CI evidence:** Run `./.bob/bin/bob-check` after meaningful changes and
  before finishing; retain its outcome with the PR. Independently inspect the
  ForgeGraph/Forgejo checks and logs for the PR's current head SHA, and confirm
  required checks pass. Local checks and a ready report do not prove remote CI
  passed. The existing
  [`autoReviewAndMerge`](../packages/bob/src/api/src/handlers/autoMergeReview.ts)
  reads `getCommitStatus` and requires `state === "success"` with `total > 0`
  for its CI gate.
- [ ] **Parent-operator merge and reporting:** The executing agent must leave
  this PR open. After verifying the delivery reports and checks, the parent
  operator merges it and confirms Bob observes the merged PR.
  [`settleWorkItemForPr`](../packages/bob/src/api/src/handlers/autoMergeReview.ts)
  mirrors `merged`; `reportToKanbanger` posts the merged PR fact and leaves
  Kanbanger's Done transition to its own gates. Verify the recorded merged fact,
  matching PR URL, Bob work-item status, and Kanbanger gate outcome separately;
  a merged PR alone does not prove the report arrived.

Record the issue/work-item/run identifiers, PR URL and head SHA, check results,
delivery evidence, and any blockers in the operator's test record. Report only
outcomes actually observed.
