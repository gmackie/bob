/**
 * Context Heuristics Service
 *
 * Implements a 3-layer gate system to determine if a task/PR has enough context
 * to proceed with automated workflows:
 *
 * Layer 1 - Hard Requirements: Repository + branch + non-trivial diff
 * Layer 2 - Lifecycle Signal: First push OR PR exists
 * Layer 3 - Quality Check: Title quality, summary content, domain relevance
 */

import type { pullRequests, repositories } from "@bob/db/schema";

// =============================================================================
// Types
// =============================================================================

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface ContextInput {
  repository: typeof repositories.$inferSelect | null;
  branch: string | null;
  diffStats: DiffStats | null;
  pullRequest: typeof pullRequests.$inferSelect | null;
  isFirstPush: boolean;
  title: string | null;
  summary: string | null;
}

export interface GateResult {
  passed: boolean;
  gate: "hard_requirements" | "lifecycle" | "quality";
  reason: string;
  details?: Record<string, unknown>;
}

export interface ContextReadiness {
  ready: boolean;
  gates: {
    hardRequirements: GateResult;
    lifecycle: GateResult;
    quality: GateResult;
  };
  score: number; // 0-100, higher is better
  suggestions: string[];
}

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // Layer 1 - Hard Requirements
  minLinesOfCode: 20,
  minFilesChanged: 2,

  // Layer 3 - Quality Check
  genericTitles: [
    "wip",
    "work in progress",
    "draft",
    "untitled",
    "new pr",
    "new pull request",
    "update",
    "fix",
    "changes",
    "test",
    "temp",
    "tmp",
  ],

  // Domain-specific nouns that indicate meaningful work
  domainNouns: [
    // Features
    "feature",
    "component",
    "module",
    "service",
    "api",
    "endpoint",
    "route",
    "handler",
    "controller",
    "middleware",
    "hook",
    "provider",
    "context",
    "store",
    "reducer",
    "action",
    "selector",
    "util",
    "helper",
    "config",
    "schema",
    "model",
    "entity",
    "migration",
    "seed",
    // UI
    "page",
    "view",
    "screen",
    "modal",
    "dialog",
    "form",
    "input",
    "button",
    "card",
    "list",
    "table",
    "chart",
    "dashboard",
    "sidebar",
    "header",
    "footer",
    "nav",
    "menu",
    // Backend
    "database",
    "query",
    "mutation",
    "subscription",
    "resolver",
    "loader",
    "validator",
    "parser",
    "serializer",
    "transformer",
    "adapter",
    "client",
    "server",
    "worker",
    "job",
    "queue",
    "cache",
    "session",
    "auth",
    "token",
    "webhook",
    "notification",
    "email",
    "sms",
    "push",
    // Testing
    "test",
    "spec",
    "mock",
    "stub",
    "fixture",
    // Infra
    "docker",
    "kubernetes",
    "terraform",
    "ci",
    "cd",
    "pipeline",
    "deploy",
    "build",
    "script",
  ],

  // Action verbs that indicate intent
  actionVerbs: [
    "add",
    "create",
    "implement",
    "build",
    "introduce",
    "setup",
    "initialize",
    "update",
    "modify",
    "change",
    "refactor",
    "improve",
    "enhance",
    "optimize",
    "fix",
    "resolve",
    "patch",
    "repair",
    "correct",
    "remove",
    "delete",
    "deprecate",
    "disable",
    "migrate",
    "convert",
    "transform",
    "upgrade",
    "downgrade",
    "integrate",
    "connect",
    "link",
    "sync",
    "merge",
    "split",
    "extract",
    "inline",
    "move",
    "rename",
    "reorganize",
    "restructure",
    "document",
    "configure",
    "enable",
    "support",
  ],

  // Minimum bullets in summary for quality
  minSummaryBullets: 2,
} as const;

// =============================================================================
// Layer 1: Hard Requirements
// =============================================================================

function checkHardRequirements(input: ContextInput): GateResult {
  // Must have a repository
  if (!input.repository) {
    return {
      passed: false,
      gate: "hard_requirements",
      reason: "No repository associated with this context",
    };
  }

  // Must have a branch
  if (!input.branch) {
    return {
      passed: false,
      gate: "hard_requirements",
      reason: "No branch specified",
    };
  }

  // Must have diff stats
  if (!input.diffStats) {
    return {
      passed: false,
      gate: "hard_requirements",
      reason: "No diff statistics available",
    };
  }

  // Non-trivial diff check: >20 LOC OR >2 files
  const { additions, deletions, filesChanged } = input.diffStats;
  const totalLinesChanged = additions + deletions;

  const meetsLocThreshold = totalLinesChanged >= CONFIG.minLinesOfCode;
  const meetsFileThreshold = filesChanged >= CONFIG.minFilesChanged;

  if (!meetsLocThreshold && !meetsFileThreshold) {
    return {
      passed: false,
      gate: "hard_requirements",
      reason: `Diff is too small: ${totalLinesChanged} lines changed across ${filesChanged} file(s). Need at least ${CONFIG.minLinesOfCode} LOC or ${CONFIG.minFilesChanged} files.`,
      details: {
        linesChanged: totalLinesChanged,
        filesChanged,
        minLoc: CONFIG.minLinesOfCode,
        minFiles: CONFIG.minFilesChanged,
      },
    };
  }

  return {
    passed: true,
    gate: "hard_requirements",
    reason: "Repository, branch, and non-trivial diff present",
    details: {
      repository: input.repository.name,
      branch: input.branch,
      linesChanged: totalLinesChanged,
      filesChanged,
    },
  };
}

// =============================================================================
// Layer 2: Lifecycle Signal
// =============================================================================

function checkLifecycleSignal(input: ContextInput): GateResult {
  // PR exists = lifecycle signal
  if (input.pullRequest) {
    return {
      passed: true,
      gate: "lifecycle",
      reason: "Pull request exists",
      details: {
        prNumber: input.pullRequest.number,
        prStatus: input.pullRequest.status,
        prUrl: input.pullRequest.url,
      },
    };
  }

  // First push = lifecycle signal
  if (input.isFirstPush) {
    return {
      passed: true,
      gate: "lifecycle",
      reason: "First push to this branch",
    };
  }

  return {
    passed: false,
    gate: "lifecycle",
    reason:
      "No lifecycle signal detected. Need either a PR or first push event.",
  };
}

// =============================================================================
// Layer 3: Quality Check
// =============================================================================

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function isGenericTitle(title: string): boolean {
  const normalized = normalizeText(title);
  return CONFIG.genericTitles.some(
    (generic) =>
      normalized === generic ||
      normalized.startsWith(`${generic} `) ||
      normalized.startsWith(`${generic}:`) ||
      normalized.startsWith(`${generic}-`),
  );
}

function containsDomainNoun(text: string): boolean {
  const normalized = normalizeText(text);
  const words = normalized.split(/\W+/);
  return CONFIG.domainNouns.some((noun) => words.includes(noun));
}

function containsActionVerb(text: string): boolean {
  const normalized = normalizeText(text);
  const words = normalized.split(/\W+/);
  return CONFIG.actionVerbs.some((verb) => words.includes(verb));
}

function countBulletPoints(text: string): number {
  // Count various bullet point formats
  const bulletPatterns = [
    /^[-*+]\s+/gm, // - * +
    /^\d+\.\s+/gm, // 1. 2. 3.
    /^•\s+/gm, // bullet character
    /^>\s+/gm, // blockquote (sometimes used as bullets)
  ];

  let count = 0;
  for (const pattern of bulletPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

function checkQuality(input: ContextInput): GateResult {
  const issues: string[] = [];
  let qualityScore = 100;

  // Check title
  if (!input.title) {
    issues.push("No title provided");
    qualityScore -= 40;
  } else {
    // Generic title check
    if (isGenericTitle(input.title)) {
      issues.push(`Title is too generic: "${input.title}"`);
      qualityScore -= 30;
    }

    // Domain noun check
    if (!containsDomainNoun(input.title)) {
      issues.push("Title lacks domain-specific terminology");
      qualityScore -= 15;
    }

    // Action verb check
    if (!containsActionVerb(input.title)) {
      issues.push("Title lacks clear action verb (add, fix, update, etc.)");
      qualityScore -= 15;
    }
  }

  // Check summary/body
  if (input.summary) {
    const bulletCount = countBulletPoints(input.summary);
    if (bulletCount < CONFIG.minSummaryBullets) {
      issues.push(
        `Summary has ${bulletCount} bullet point(s), need at least ${CONFIG.minSummaryBullets}`,
      );
      qualityScore -= 20;
    }
  } else {
    issues.push("No summary/description provided");
    qualityScore -= 20;
  }

  const passed = qualityScore >= 50;

  return {
    passed,
    gate: "quality",
    reason: passed
      ? "Title and summary meet quality standards"
      : `Quality check failed (score: ${qualityScore}/100)`,
    details: {
      qualityScore,
      issues: issues.length > 0 ? issues : undefined,
      title: input.title,
      hasSummary: !!input.summary,
      bulletCount: input.summary ? countBulletPoints(input.summary) : 0,
    },
  };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Evaluates whether a given context (PR, task, branch) has enough information
 * to proceed with automated workflows.
 *
 * The 3-layer gate system:
 * 1. Hard Requirements: Must have repo, branch, and non-trivial diff
 * 2. Lifecycle Signal: Must have PR or be first push
 * 3. Quality Check: Title and summary must meet quality standards
 *
 * All three layers must pass for the context to be considered "ready".
 */
export function evaluateContextReadiness(
  input: ContextInput,
): ContextReadiness {
  const hardRequirements = checkHardRequirements(input);
  const lifecycle = checkLifecycleSignal(input);
  const quality = checkQuality(input);

  const gates = {
    hardRequirements,
    lifecycle,
    quality,
  };

  // All gates must pass
  const ready = hardRequirements.passed && lifecycle.passed && quality.passed;

  // Calculate overall score (0-100)
  let score = 0;
  if (hardRequirements.passed) score += 40;
  if (lifecycle.passed) score += 30;
  if (quality.passed) score += 30;

  // Generate suggestions for improvement
  const suggestions: string[] = [];

  if (!hardRequirements.passed) {
    if (!input.repository) {
      suggestions.push("Link this work to a repository");
    }
    if (!input.branch) {
      suggestions.push("Create a branch for this work");
    }
    if (input.diffStats) {
      const { additions, deletions, filesChanged } = input.diffStats;
      const total = additions + deletions;
      if (
        total < CONFIG.minLinesOfCode &&
        filesChanged < CONFIG.minFilesChanged
      ) {
        suggestions.push(
          `Make more substantial changes (currently ${total} LOC, ${filesChanged} files)`,
        );
      }
    }
  }

  if (!lifecycle.passed) {
    suggestions.push("Push your changes to create a lifecycle signal");
    suggestions.push("Or create a pull request to mark this work as ready");
  }

  if (!quality.passed && quality.details) {
    const details = quality.details as { issues?: string[] };
    if (details.issues) {
      for (const issue of details.issues) {
        if (issue.includes("generic")) {
          suggestions.push(
            'Use a more descriptive title (e.g., "Add user authentication feature")',
          );
        } else if (issue.includes("domain")) {
          suggestions.push(
            "Include domain-specific terms in your title (e.g., component, service, API)",
          );
        } else if (issue.includes("action verb")) {
          suggestions.push(
            'Start your title with an action verb (e.g., "Add", "Fix", "Update")',
          );
        } else if (issue.includes("bullet")) {
          suggestions.push(
            "Add bullet points to your PR description summarizing the changes",
          );
        } else if (issue.includes("summary")) {
          suggestions.push("Add a description explaining what this PR does");
        }
      }
    }
  }

  return {
    ready,
    gates,
    score,
    suggestions: [...new Set(suggestions)], // dedupe
  };
}

/**
 * Quick check if context is ready without full analysis.
 * Use this for fast filtering before doing expensive operations.
 */
export function isContextReady(input: ContextInput): boolean {
  // Quick fail checks (avoid expensive operations)
  if (!input.repository || !input.branch) return false;
  if (!input.diffStats) return false;
  if (!input.pullRequest && !input.isFirstPush) return false;

  // Quick diff check
  const { additions, deletions, filesChanged } = input.diffStats;
  const totalLinesChanged = additions + deletions;
  if (
    totalLinesChanged < CONFIG.minLinesOfCode &&
    filesChanged < CONFIG.minFilesChanged
  ) {
    return false;
  }

  // Quick title check
  if (!input.title || isGenericTitle(input.title)) return false;

  return true;
}

/**
 * Parse diff stats from various formats.
 * Handles git diff --stat output, GitHub API response, etc.
 */
export function parseDiffStats(
  input:
    | string
    | { additions?: number; deletions?: number; changed_files?: number }
    | null,
): DiffStats | null {
  if (!input) return null;

  if (typeof input === "string") {
    // Parse git diff --stat output
    // e.g., "3 files changed, 42 insertions(+), 8 deletions(-)"
    const filesMatch = input.match(/(\d+)\s+files?\s+changed/);
    const insertionsMatch = input.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionsMatch = input.match(/(\d+)\s+deletions?\(-\)/);

    return {
      filesChanged: filesMatch ? parseInt(filesMatch[1]!, 10) : 0,
      additions: insertionsMatch ? parseInt(insertionsMatch[1]!, 10) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1]!, 10) : 0,
    };
  }

  // Handle object format (GitHub API, etc.)
  return {
    additions: input.additions ?? 0,
    deletions: input.deletions ?? 0,
    filesChanged: input.changed_files ?? 0,
  };
}

/**
 * Build ContextInput from a pull request record.
 * Convenience function for common use case.
 */
export function buildContextFromPR(
  pr: typeof pullRequests.$inferSelect,
  repository: typeof repositories.$inferSelect | null,
  isFirstPush = false,
): ContextInput {
  return {
    repository,
    branch: pr.headBranch,
    diffStats:
      pr.additions !== null && pr.deletions !== null
        ? {
            additions: pr.additions,
            deletions: pr.deletions,
            filesChanged: pr.changedFiles ?? 0,
          }
        : null,
    pullRequest: pr,
    isFirstPush,
    title: pr.title,
    summary: pr.body,
  };
}
