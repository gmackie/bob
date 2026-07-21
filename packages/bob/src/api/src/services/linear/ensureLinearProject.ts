/**
 * Shared helper to find-or-create a Bob project for a Linear project.
 *
 * Used by both the explicit "sync Linear projects" handler and the Linear
 * webhook (so new Linear projects self-onboard). Keeping it in one place means
 * the key-generation and provider-linking rules don't drift between the two
 * entry points.
 */
import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { projects } from "@bob/db/schema";

export interface EnsureLinearProjectInput {
  workspaceId: string;
  /** The Linear project id, or a synthetic `team:<teamId>` id for issues that
   *  have no Linear project (so they still land in a stable Bob project). */
  linearProjectId: string;
  name: string;
  /** Default false — synced projects are visible but don't auto-run agents. */
  autoDispatch?: boolean;
}

export interface EnsureLinearProjectResult {
  project: typeof projects.$inferSelect;
  created: boolean;
}

/** Derive a short uppercase key from a project name (e.g. "Splat GTM" → "SG"). */
function deriveKeyBase(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base: string;
  const [firstWord] = words;
  if (words.length >= 2) {
    base = words.map((w) => w[0]).join("");
  } else if (firstWord) {
    base = firstWord.slice(0, 6);
  } else {
    base = "PROJ";
  }
  base = base.replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return base.length > 0 ? base : "PROJ";
}

async function generateUniqueProjectKey(
  db: Db,
  workspaceId: string,
  name: string,
): Promise<string> {
  const existing = await db.query.projects.findMany({
    where: eq(projects.workspaceId, workspaceId),
    columns: { key: true },
  });
  const used = new Set<string>(existing.map((p) => p.key));

  const base = deriveKeyBase(name);
  if (!used.has(base)) return base;

  let n = 2;
  // Keep within the 16-char column limit while staying unique.
  while (used.has(`${base}${n}`.slice(0, 16))) n++;
  return `${base}${n}`.slice(0, 16);
}

export async function ensureLinearProject(
  db: Db,
  input: EnsureLinearProjectInput,
): Promise<EnsureLinearProjectResult> {
  const existing = await db.query.projects.findFirst({
    where: and(
      eq(projects.workspaceId, input.workspaceId),
      eq(projects.planningProvider, "linear"),
      eq(projects.linearProjectId, input.linearProjectId),
    ),
  });
  if (existing) return { project: existing, created: false };

  const key = await generateUniqueProjectKey(db, input.workspaceId, input.name);

  const [created] = await db
    .insert(projects)
    .values({
      workspaceId: input.workspaceId,
      name: input.name.slice(0, 128),
      key,
      planningProvider: "linear",
      linearProjectId: input.linearProjectId,
      automationSettings: { autoDispatch: input.autoDispatch ?? false },
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create Bob project for Linear project");
  }

  return { project: created, created: true };
}

/** Map a Linear workflow state type to a Bob work-item status. */
export function mapLinearStatusToBob(stateType: string): string {
  switch (stateType) {
    case "backlog":
      return "backlog";
    case "unstarted":
      return "todo";
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "draft";
  }
}

/** Linear state types that are "open" (not finished) — used for issue backfill. */
export function isOpenLinearState(stateType: string): boolean {
  return stateType !== "completed" && stateType !== "canceled" && stateType !== "cancelled";
}
