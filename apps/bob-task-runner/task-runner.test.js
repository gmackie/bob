// Regression tests for the scan-loop candidate gates.
//
// Run: node --test apps/bob-task-runner/task-runner.test.js
//
// The headline test (`poison-pill`) reproduces the production stall of
// 2026-08: startup slug `classcheck` mapped to a repo that exists nowhere
// (gmackie/classcheck), so its P0 issue GMA-406 failed to clone every cycle,
// was unclaimed, then re-selected next cycle — head-of-line blocking every
// other startup's work. The runner already recorded the failed slug in
// `_cloneFailed`, but the selection loop never consulted it. slugEligible now
// does; this test fails if that guard is ever removed again.

const test = require("node:test");
const assert = require("node:assert/strict");

const { slugEligible, issueClaimable, cloneBenched } = require("./task-runner.js");

const NOW = Date.parse("2026-08-13T00:00:00Z");
const DEFAULT_SLUGS = new Set(["bizpulse", "classcheck", "bob"]);

function eligibleArgs(overrides = {}) {
  return {
    projectId: "proj-1",
    repoDir: "/home/bob/dev/whatever",
    cloneBenched: false,
    repoExists: true,
    hasRemote: true,
    ...overrides,
  };
}

test("slugEligible: a slug currently benched for a clone failure is skipped", () => {
  assert.equal(
    slugEligible("classcheck", eligibleArgs({ cloneBenched: true })),
    false,
    "classcheck must be excluded while benched",
  );
  assert.equal(
    slugEligible("bob", eligibleArgs({ cloneBenched: false })),
    true,
    "an unrelated (un-benched) slug is unaffected",
  );
});

test("cloneBenched: benches within cooldown, self-heals after it (transient failures retry)", () => {
  const map = new Map([["classcheck", NOW]]);
  const cooldown = 30 * 60_000;
  // Just failed -> benched.
  assert.equal(cloneBenched("classcheck", map, NOW + 60_000, cooldown), true);
  // After the cooldown -> retryable again (a transient blip must not bench a
  // good repo forever).
  assert.equal(cloneBenched("classcheck", map, NOW + cooldown + 1, cooldown), false);
  // A slug that never failed is never benched.
  assert.equal(cloneBenched("bob", map, NOW, cooldown), false);
});

test("slugEligible: missing project or repo is skipped", () => {
  assert.equal(slugEligible("x", eligibleArgs({ projectId: undefined })), false);
  assert.equal(slugEligible("x", eligibleArgs({ repoDir: undefined })), false);
});

test("slugEligible: no local dir and no remote means unmaterializable, skip", () => {
  assert.equal(
    slugEligible("x", eligibleArgs({ repoExists: false, hasRemote: false })),
    false,
  );
  assert.equal(
    slugEligible("x", eligibleArgs({ repoExists: false, hasRemote: true })),
    true,
    "no dir on disk is fine when the remote config can clone it",
  );
});

test("slugEligible: a repo-optional slug is claimable with no repo at all", () => {
  // Knowledge/ops startup: has a Linear project but no repoSlug -> runs in a
  // scratch dir, so no repoDir and no remote are required.
  assert.equal(
    slugEligible("classcheck", {
      projectId: "proj-1",
      repoDir: null,
      cloneFailed: new Set(),
      repoExists: false,
      hasRemote: false,
      repoOptional: true,
    }),
    true,
  );
});

test("slugEligible: a repo-optional slug still needs a project", () => {
  assert.equal(
    slugEligible("x", { projectId: undefined, cloneFailed: new Set(), repoOptional: true }),
    false,
  );
});

test("poison-pill: one un-clonable slug does not starve the rest of the queue", () => {
  // The scan sees two startups. classcheck's repo does not exist, so after the
  // first cycle its slug is on _cloneFailed. On the next cycle the loop must
  // drop classcheck entirely and let bob's issue through.
  const benched = new Set(["classcheck"]); // classcheck failed to clone last cycle
  const scan = [
    { slug: "classcheck", repoExists: false, hasRemote: true, issues: [
      { id: "i-406", identifier: "GMA-406", title: "Refresh stale KB entries", priority: 0, updatedAt: "2026-08-12T00:00:00Z", description: "" },
    ] },
    { slug: "bob", repoExists: true, hasRemote: true, issues: [
      { id: "i-500", identifier: "GMA-500", title: "Fix login redirect", priority: 2, updatedAt: "2026-08-12T00:00:00Z", description: "" },
    ] },
  ];

  const candidates = [];
  for (const s of scan) {
    if (!slugEligible(s.slug, eligibleArgs({ cloneBenched: benched.has(s.slug), repoExists: s.repoExists, hasRemote: s.hasRemote }))) continue;
    for (const issue of s.issues) {
      if (issueClaimable(s.slug, issue, { now: NOW, defaultSlugs: DEFAULT_SLUGS })) {
        candidates.push({ slug: s.slug, id: issue.id });
      }
    }
  }

  assert.deepEqual(
    candidates,
    [{ slug: "bob", id: "i-500" }],
    "classcheck (P0, un-clonable) is dropped; bob's real work becomes claimable",
  );
});

test("issueClaimable: bizpulse issues need the growth marker", () => {
  const base = { id: "1", identifier: "GMA-1", title: "x", priority: 1, updatedAt: "2026-08-12T00:00:00Z" };
  assert.equal(
    issueClaimable("bizpulse", { ...base, description: "no marker here" }, { now: NOW, defaultSlugs: DEFAULT_SLUGS }),
    false,
  );
  assert.equal(
    issueClaimable("bizpulse", { ...base, description: "## Agent Instructions — growth.\ngo" }, { now: NOW, defaultSlugs: DEFAULT_SLUGS }),
    true,
  );
  // Non-bizpulse projects have no marker requirement.
  assert.equal(
    issueClaimable("bob", { ...base, description: "" }, { now: NOW, defaultSlugs: DEFAULT_SLUGS }),
    true,
  );
});

test("issueClaimable: stale [pulse] work orders are never auto-claimed", () => {
  const stale = { id: "1", identifier: "GMA-1", title: "[pulse] launch billing", priority: 2, updatedAt: "2026-07-01T00:00:00Z", description: "" };
  assert.equal(issueClaimable("bob", stale, { now: NOW, defaultSlugs: DEFAULT_SLUGS }), false);
  const fresh = { ...stale, updatedAt: "2026-08-12T00:00:00Z" };
  assert.equal(issueClaimable("bob", fresh, { now: NOW, defaultSlugs: DEFAULT_SLUGS }), true);
});

test("issueClaimable: stale issue on a remote-only slug is skipped", () => {
  const stale = { id: "1", identifier: "GMA-1", title: "audit fix", priority: 1, updatedAt: "2026-07-01T00:00:00Z", description: "" };
  // remote-only slug (not in defaults) + stale => skip
  assert.equal(issueClaimable("newco", stale, { now: NOW, defaultSlugs: DEFAULT_SLUGS }), false);
  // hardcoded-default slug + stale (non-[pulse]) => still claimable
  assert.equal(issueClaimable("bob", stale, { now: NOW, defaultSlugs: DEFAULT_SLUGS }), true);
});
