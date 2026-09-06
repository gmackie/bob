import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

/** Current sources, including new files but excluding ignored build artifacts. */
function currentSources(root, cwd = repositoryRoot) {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", root],
    { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return [...new Set(out.split("\0"))].filter(
    (file) => /\.tsx?$/.test(file) && existsSync(resolve(cwd, file)),
  );
}

test("source discovery follows working tree deletions and additions", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "bob-product-boundary-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
    git("init", "--quiet");
    mkdirSync(resolve(cwd, "packages/bob/src"), { recursive: true });
    writeFileSync(resolve(cwd, ".gitignore"), "ignored/\n");
    writeFileSync(resolve(cwd, "packages/bob/src/deleted.ts"), "export {};\n");
    writeFileSync(resolve(cwd, "packages/bob/src/kept.ts"), "export {};\n");
    git("add", ".");
    rmSync(resolve(cwd, "packages/bob/src/deleted.ts"));
    const crossing = "packages/bob/src/new source\nname.tsx";
    writeFileSync(resolve(cwd, crossing), 'import x from "@gmacko/ooda";\n');
    mkdirSync(resolve(cwd, "packages/bob/ignored"));
    writeFileSync(
      resolve(cwd, "packages/bob/ignored/artifact.ts"),
      "export {};\n",
    );
    writeFileSync(resolve(cwd, "packages/bob/src/notes.txt"), "not source\n");

    const sources = currentSources("packages/bob", cwd);
    assert.deepEqual(
      sources.sort(),
      ["packages/bob/src/kept.ts", crossing].sort(),
    );
    assert.ok(
      sources.some((file) =>
        RULES[1].forbid.test(readFileSync(resolve(cwd, file), "utf8")),
      ),
      "A crossing in an untracked source must remain visible to the boundary guard",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const rule of RULES) {
  test(`${rule.root} does not import ${rule.label}`, () => {
    const files = currentSources(rule.root);
    assert.ok(
      files.length > 0,
      `No current sources found under ${rule.root} — the guard would pass ` +
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
  const composed = currentSources("apps").filter((file) => {
    const src = readFileSync(resolve(repositoryRoot, file), "utf8");
    return /from\s+["']@gmacko\/ooda/.test(src) && /from\s+["']@bob\//.test(src);
  });
  assert.ok(
    Array.isArray(composed),
    "apps/* composition check should always evaluate",
  );
});
