#!/usr/bin/env node
/**
 * Parity census: standalone `ooda` repo vs its fold at `packages/ooda`.
 *
 * Run once, before the standalone repo is archived, to prove the fold is a
 * strict superset. Every exported symbol in the standalone packages must
 * exist somewhere in the fold, or be explicitly classified as an intentional
 * drop below. Anything else is unclassified and fails the census.
 *
 * This is a symbol census — it sees exports, not configuration. Migrations,
 * env vars and service units need a separate hand-diff; the report records
 * whether that was done so the evidence is not silently partial.
 *
 *   node scripts/compare-ooda-fold-parity.mjs [--ooda-repo <path>] [--write]
 *
 * Exit 0 when parity holds, 1 when it does not.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const oodaRepo = resolve(flag("--ooda-repo", join(repoRoot, "..", "ooda")));
const shouldWrite = argv.includes("--write");

/**
 * Exports deliberately not carried into the fold, with the reason. An entry
 * here is a decision on the record, not a gap — the census prints them so
 * they stay visible rather than disappearing into a passing run.
 */
const INTENTIONAL_DROPS = [
  {
    match: /^ui\//,
    reason:
      "@ooda/ui is a strict subset of @gmacko/core/ui, which carries every " +
      "component plus ~15 more. Only button.stories.tsx has no counterpart.",
  },
  {
    match: /^(eslint-config|prettier-config|tsconfig|vitest-config|tailwind-config)\//,
    reason:
      "Tooling packages were repointed to the @bob/* tooling equivalents in " +
      "Phase 8A decision 8; never intended to be copied.",
  },
  {
    match: /^db\/src\/auth\.ts$/,
    reason:
      "Superseded by the Phase 7B-3 auth migration. The fold has no " +
      "db/auth.ts: session validation comes from @gmacko/core/auth " +
      "(AuthInstance, validateApiKey, SessionValidationResult), wired in " +
      "api/trpc.ts. The standalone versions had no production consumer " +
      "either — only their own tests imported them.",
  },
];

/** Source files only — tests define no shipped surface. */
const isSource = (path) =>
  path.endsWith(".ts") &&
  !path.endsWith(".d.ts") &&
  !path.includes("__tests__") &&
  !path.includes(".test.") &&
  !path.includes(".stories.");

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(full)) out.push(full);
  }
  return out;
}

/**
 * Pull exported symbol names out of a TS source file. Deliberately a text
 * scan, not a type-aware parse: the census runs against two trees that do not
 * share a tsconfig, and a resolver would need both to build first.
 */
function exportsOf(file) {
  const src = readFileSync(file, "utf8");
  const names = new Set();

  const declaration =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(declaration)) names.add(m[1]);

  // export { a, b as c } / export type { T }
  const braced = /^export\s+(?:type\s+)?\{([^}]*)\}/gms;
  for (const m of src.matchAll(braced)) {
    for (const part of m[1].split(",")) {
      const cleaned = part.replace(/\btype\b/g, "").trim();
      if (!cleaned) continue;
      const alias = cleaned.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim();
      if (/^[A-Za-z0-9_$]+$/.test(name) && name !== "default") names.add(name);
    }
  }
  return names;
}

function collect(root, label) {
  const files = walk(root);
  const symbols = new Map(); // name -> Set(relative file)
  for (const file of files) {
    for (const name of exportsOf(file)) {
      const rel = relative(root, file);
      if (!symbols.has(name)) symbols.set(name, new Set());
      symbols.get(name).add(rel);
    }
  }
  return { label, root, files: files.length, symbols };
}

const standalone = collect(join(oodaRepo, "packages"), "ooda repo");

/**
 * The fold's surface spans two package roots, not one. Most of OODA landed in
 * `packages/ooda`, but anything both products need is shared infrastructure and
 * belongs in `@gmacko/core` — the Skillfleet workflow journal and the embedding
 * telemetry span both live there. Scanning only `packages/ooda` would report a
 * symbol as lost the moment it moved to its correct home.
 */
const foldRoots = [
  join(repoRoot, "packages", "ooda", "src"),
  join(repoRoot, "packages", "core", "src"),
];
const fold = foldRoots
  .map((root) => collect(root, "bob fold"))
  .reduce((merged, part) => {
    for (const [name, locations] of part.symbols) {
      if (!merged.symbols.has(name)) merged.symbols.set(name, new Set());
      for (const location of locations) merged.symbols.get(name).add(location);
    }
    merged.files += part.files;
    return merged;
  });

if (standalone.files === 0) {
  console.error(
    `No standalone sources found under ${standalone.root}.\n` +
      `Pass --ooda-repo <path> if the repo lives elsewhere.`,
  );
  process.exit(1);
}

const missing = [];
const dropped = [];

for (const [name, locations] of standalone.symbols) {
  if (fold.symbols.has(name)) continue;

  const location = [...locations][0];
  const drop = INTENTIONAL_DROPS.find((d) => d.match.test(location));
  if (drop) {
    dropped.push({ symbol: name, location, reason: drop.reason });
  } else {
    missing.push({ symbol: name, locations: [...locations].sort() });
  }
}

const foldOnly = [...fold.symbols.keys()].filter(
  (name) => !standalone.symbols.has(name),
).length;

const report = {
  generatedFrom: {
    fold: foldRoots.map((root) => relative(repoRoot, root)),
    standalone: oodaRepo,
  },
  method:
    "Text scan of exported symbol names across non-test sources in both trees.",
  caveat:
    "Symbol-level only. Migrations, .env.example and service units are not " +
    "covered and require the hand-diff recorded under handDiff below.",
  counts: {
    standaloneFiles: standalone.files,
    foldFiles: fold.files,
    standaloneSymbols: standalone.symbols.size,
    foldSymbols: fold.symbols.size,
    foldOnlySymbols: foldOnly,
    intentionalDrops: dropped.length,
    unclassifiedMissing: missing.length,
  },
  handDiff: {
    migrations:
      "DONE 2026-08-23 — all 6 numbered (0000_certain_orphan … " +
      "0005_premium_stardust) and all 5 custom (001_buddy_notify … " +
      "005_session_output_notify) standalone migrations are present in the " +
      "fold, which carries 36 total. No standalone migration is missing.",
    envExample:
      "DONE 2026-08-23 — three standalone keys had no literal match in the " +
      "fold. BIZPULSE_API_URL and OODA_STORAGE_ROOT are present under a " +
      "prefix or as a commented default, so they are naming differences, " +
      "not gaps. DATABASE_URL was a real documentation gap: db/client.ts " +
      "throws at import without it, but only STANDALONE_OODA_DATABASE_URL " +
      "was documented. Added to .env.example in this change.",
  },
  intentionalDrops: dropped.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  unclassifiedMissing: missing.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  verdict: missing.length === 0 ? "PARITY" : "OODA_AHEAD",
};

if (shouldWrite) {
  const out = join(repoRoot, "docs", "migrations", "ooda-fold-parity.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${relative(repoRoot, out)}`);
}

const { counts } = report;
console.log(
  `\nParity census — ${standalone.label} vs ${fold.label}\n` +
    `  standalone: ${counts.standaloneFiles} files, ${counts.standaloneSymbols} exports\n` +
    `  fold:       ${counts.foldFiles} files, ${counts.foldSymbols} exports ` +
    `(${counts.foldOnlySymbols} fold-only)\n` +
    `  intentional drops: ${counts.intentionalDrops}\n` +
    `  unclassified missing: ${counts.unclassifiedMissing}\n`,
);

for (const drop of dropped) {
  console.log(`  · dropped  ${drop.symbol}  (${drop.location})`);
}

if (missing.length > 0) {
  console.error("Exports present in the standalone repo but not in the fold:\n");
  for (const entry of missing) {
    console.error(`  ✗ ${entry.symbol}  —  ${entry.locations.join(", ")}`);
  }
  console.error(
    `\nVerdict: OODA_AHEAD. Port these or classify them as intentional drops ` +
      `before archiving the standalone repo.`,
  );
  process.exit(1);
}

console.log("Verdict: PARITY — the fold is a strict superset.");
