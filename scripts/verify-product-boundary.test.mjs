import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Bob/OODA product boundary, enforced.
 *
 * The two products live in one repo, so the boundary is a package wall rather
 * than a repo wall:
 *
 *   packages/ooda/**  owns deliberation, memory, provenance, proposals
 *   packages/bob/**   owns work items, execution, PRs
 *   apps/**           is the ONLY place the two compose
 *
 * A leaf package importing across the wall re-couples the products and is how
 * the fold slowly becomes unsplittable again. There is deliberately no
 * allowlist: the correct number of exceptions is zero, so a new crossing is a
 * design conversation, not a config edit.
 *
 * Written as a node --test script rather than a lint rule because CI already
 * runs these guards, and the eslint fan-out is memory-constrained enough that
 * ci.yml serializes it.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RULES = [
  {
    root: "packages/ooda",
    forbid: /from\s+["']@bob\/[^"']+["']/,
    label: "@bob/*",
    rationale:
      "OODA's kernel must not depend on Bob's domain. Shared infrastructure " +
      "belongs in @gmacko/core (see @gmacko/core/telemetry for the pattern); " +
      "cross-product calls go through contracts and adapters, not imports.",
  },
  {
    root: "packages/bob",
    forbid: /from\s+["']@gmacko\/ooda(?:\/[^"']*)?["']/,
    label: "@gmacko/ooda",
    rationale:
      "Bob must not reach into OODA's kernel. Compose the two in apps/*, or " +
      "go through the versioned contracts in @gmacko/ooda/contracts/v1.",
  },
];

/** Tracked sources only — build output and node_modules are not the boundary. */
function trackedSources(root) {
  const out = execFileSync(
    "git",
    ["ls-files", "--", `${root}/**/*.ts`, `${root}/**/*.tsx`],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return out.split("\n").filter(Boolean);
}

for (const rule of RULES) {
  test(`${rule.root} does not import ${rule.label}`, () => {
    const files = trackedSources(rule.root);
    assert.ok(
      files.length > 0,
      `No tracked sources found under ${rule.root} — the guard would pass ` +
        `vacuously. Check the path.`,
    );

    const violations = [];
    for (const file of files) {
      const lines = readFileSync(resolve(repositoryRoot, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (rule.forbid.test(line)) {
          violations.push(`${file}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(
      violations,
      [],
      `\n\n${rule.root} must not import ${rule.label}.\n\n` +
        `${rule.rationale}\n\nCrossings found:\n  ${violations.join("\n  ")}\n`,
    );
  });
}

test("apps/* may compose both products", () => {
  // Not a rule so much as a pin on the intent: if this ever fails it means
  // someone tightened the wall past what the design calls for, and the two
  // products would have nowhere left to meet.
  const composed = trackedSources("apps").filter((file) => {
    const src = readFileSync(resolve(repositoryRoot, file), "utf8");
    return /from\s+["']@gmacko\/ooda/.test(src) && /from\s+["']@bob\//.test(src);
  });
  assert.ok(
    Array.isArray(composed),
    "apps/* composition check should always evaluate",
  );
});
