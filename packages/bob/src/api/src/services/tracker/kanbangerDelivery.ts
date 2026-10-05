/**
 * Kanbanger delivery reports — Bob telling Kanbanger "this issue is READY TO
 * TEST / REVIEW" (and other delivery facts such as a PR opening or merging).
 *
 * Why a REST call and not the GraphQL `issueUpdate` Bob used before: the
 * review state is no longer Bob's to set. Kanbanger owns the issue's progress
 * gates, so `POST /api/workspaces/{workspaceId}/delivery` asks Kanbanger to move
 * the issue to its review state *if its gates allow it*, records the report
 * (summary, test plan, PR/preview links) on the issue, and notifies the human
 * reviewer, who then Approves or Requests changes. Likewise Done now comes from
 * Kanbanger's gates and merges, never from Bob forcing a `completed` state.
 *
 * Contract (see the Kanbanger delivery-reporting plan):
 *  - 201 `{ event, issueId }`                        → reported; issue In Review.
 *  - 409 `{ _tag: "Conflict", reason: "progress-gate-blocked" }`
 *                                                     → unmet gates. Bob must NOT
 *                                                       claim the item is ready.
 *  - 404 / network error                             → endpoint not deployed yet
 *                                                       or issue unknown: callers
 *                                                       fall back to the previous
 *                                                       GraphQL behaviour.
 *
 * Every function here returns a result instead of throwing: the tracker is a
 * mirror of Bob's loop, never a dependency of it.
 *
 * Credentials: the same Kanbanger API key Bob already uses for GraphQL, sent as
 * a bearer. It is only ever sent to the origin of the integration's configured
 * `linearApiUrl` — never to api.linear.app, which has no such endpoint — so a
 * real Linear integration keeps its exact previous behaviour.
 */
import { tracedFetch } from "@gmacko/core/telemetry/deep";

export type DeliveryKind = "review_request" | "pr";

export interface DeliveryArtifact {
  type: "pr" | "preview" | "commit";
  url: string;
}

export interface DeliveryReport {
  /** Kanbanger issue UUID. Either this or `identifier` must be set. */
  issueId?: string;
  /** Kanbanger issue identifier, e.g. "GMA-612". */
  identifier?: string;
  kind: DeliveryKind;
  status: string;
  subject: string;
  externalId: string;
  title?: string;
  summary?: string;
  url?: string;
  producer: "bob";
  payload?: {
    testPlan?: string[];
    artifacts?: DeliveryArtifact[];
  };
}

export type DeliveryResult =
  | { ok: true; issueId: string | null }
  /** 409 progress-gate-blocked — the issue is not allowed into review yet. */
  | { ok: false; kind: "gate_blocked"; status: 409; reason: string; detail: string }
  /** 404, 5xx, timeout, DNS — the endpoint is unavailable; fall back. */
  | { ok: false; kind: "unavailable"; status: number | null; detail: string }
  /** Any other 4xx — Kanbanger understood and refused the report. */
  | { ok: false; kind: "rejected"; status: number; detail: string };

export interface KanbangerDeliveryConfig {
  /** The integration's `linearApiUrl` (e.g. https://tasks.gmac.io/graphql). */
  apiUrl: string | null | undefined;
  apiKey: string;
}

/**
 * The origin that serves the delivery API, or null when the integration is not
 * a Kanbanger (Linear-compatible clone) integration. A NULL `linearApiUrl` means
 * real Linear (the SDK default), and so does an explicit linear.app host.
 */
export function kanbangerOrigin(apiUrl: string | null | undefined): string | null {
  if (!apiUrl) return null;
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
  if (url.username || url.password) return null;
  if (url.hostname === "linear.app" || url.hostname.endsWith(".linear.app")) return null;
  return url.origin;
}

export function isKanbangerIntegration(apiUrl: string | null | undefined): boolean {
  return kanbangerOrigin(apiUrl) !== null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Work items imported from Kanbanger carry either the issue UUID (current
 * importer) or the identifier (older rows, e.g. "GMA-5") in `external_id`.
 */
export function issueReference(externalId: string): { issueId: string } | { identifier: string } {
  return UUID_RE.test(externalId) ? { issueId: externalId } : { identifier: externalId };
}

export async function postDeliveryReport(
  config: KanbangerDeliveryConfig,
  workspaceId: string,
  report: DeliveryReport,
  opts: { timeoutMs?: number } = {},
): Promise<DeliveryResult> {
  const origin = kanbangerOrigin(config.apiUrl);
  if (!origin) {
    return { ok: false, kind: "unavailable", status: null, detail: "not a Kanbanger integration" };
  }
  const endpoint = new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/delivery`, origin);

  let response: Response;
  try {
    response = await tracedFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      },
      { service: "kanbanger", baseUrl: origin },
    );
  } catch (err) {
    return {
      ok: false,
      kind: "unavailable",
      status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const body = await readJson(response);
  if (response.status === 200 || response.status === 201) {
    const issueId = typeof body?.issueId === "string" ? body.issueId : null;
    return { ok: true, issueId };
  }
  if (response.status === 409) {
    const reason = typeof body?.reason === "string" ? body.reason : "conflict";
    return { ok: false, kind: "gate_blocked", status: 409, reason, detail: describeBody(body) };
  }
  if (response.status === 404 || response.status >= 500) {
    return { ok: false, kind: "unavailable", status: response.status, detail: describeBody(body) };
  }
  return { ok: false, kind: "rejected", status: response.status, detail: describeBody(body) };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function describeBody(body: Record<string, unknown> | null): string {
  if (!body) return "(no body)";
  const parts = ["_tag", "reason", "message"]
    .map((k) => {
      const v = body[k];
      return typeof v === "string" ? `${k}=${v}` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" ") : JSON.stringify(body).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

export interface ReviewRequestInput {
  /** The Kanbanger issue UUID or identifier (the work item's external_id). */
  externalIssueId: string;
  workItemId: string;
  /** 1 for the first ready report, +1 for every re-report after changes. */
  revision: number;
  summary: string;
  testPlan: string[];
  prUrl?: string | null;
  commitUrl?: string | null;
  previewUrl?: string | null;
}

/**
 * The READY TO TEST / REVIEW report. `subject` is stable per work item so
 * Kanbanger groups every revision under one review thread; `externalId` adds the
 * revision so a re-report after "Request changes" is a new event, not a retry
 * of the old one (and a genuine retry of the same revision stays idempotent).
 */
export function buildReviewRequest(input: ReviewRequestInput): DeliveryReport {
  const artifacts: DeliveryArtifact[] = [];
  if (input.prUrl) artifacts.push({ type: "pr", url: input.prUrl });
  if (input.previewUrl) artifacts.push({ type: "preview", url: input.previewUrl });
  if (input.commitUrl) artifacts.push({ type: "commit", url: input.commitUrl });
  return {
    ...issueReference(input.externalIssueId),
    kind: "review_request",
    status: "ready",
    subject: `bob:review:${input.workItemId}`,
    externalId: `bob:review:${input.workItemId}:${input.revision}`,
    title: "Ready for review",
    summary: input.summary,
    ...(input.prUrl ? { url: input.prUrl } : {}),
    producer: "bob",
    payload: { testPlan: input.testPlan, artifacts },
  };
}

/** A PR delivery fact (opened / merged). Subject and externalId are the PR URL. */
export function buildPrFact(
  externalIssueId: string,
  prUrl: string,
  status: "opened" | "merged",
): DeliveryReport {
  return {
    ...issueReference(externalIssueId),
    kind: "pr",
    status,
    subject: prUrl,
    externalId: prUrl,
    url: prUrl,
    producer: "bob",
    payload: { artifacts: [{ type: "pr", url: prUrl }] },
  };
}

// ---------------------------------------------------------------------------
// Summary / test plan derivation
// ---------------------------------------------------------------------------

const TEST_PLAN_HEADINGS = /^(?:test(?:ing)? plan|how to (?:test|verify)|verification|manual (?:test|qa)(?: steps)?|qa|steps to (?:test|verify))\b/i;
const MAX_SUMMARY = 4_000;

/** Lines of a markdown section whose heading matches `heading`, up to the next heading. */
function sectionLines(markdown: string, heading: RegExp): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = /^\s*(?:#{1,6}\s+|\*\*)(.+?)(?:\*\*)?:?\s*$/.exec(l);
    return m?.[1] ? heading.test(m[1].trim()) : false;
  });
  if (start < 0) return null;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s+/.test(line) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(line)) break;
    out.push(line);
  }
  return out;
}

/** Turn bullet / numbered / checkbox lines into plain steps. */
function listItems(lines: string[]): string[] {
  return lines
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(l)?.[1]?.trim())
    .filter((s): s is string => Boolean(s));
}

/**
 * Concrete steps a human follows to verify the change. Preference order:
 *  1. an explicit "Test plan" / "How to test" section the agent wrote (in its
 *     final message or the PR body),
 *  2. the issue's acceptance criteria (checkbox items in its description),
 *     each phrased as something to confirm,
 *  3. otherwise a minimal plan built from the links Bob actually has.
 * The PR/CI steps are always appended so the plan is never empty.
 */
export function deriveTestPlan(input: {
  agentSummary?: string | null;
  prBody?: string | null;
  issueDescription?: string | null;
  prUrl?: string | null;
  previewUrl?: string | null;
}): string[] {
  const steps: string[] = [];
  for (const source of [input.agentSummary, input.prBody]) {
    if (!source || steps.length) continue;
    const section = sectionLines(source, TEST_PLAN_HEADINGS);
    if (section) steps.push(...listItems(section));
  }
  if (!steps.length && input.issueDescription) {
    const criteria = sectionLines(input.issueDescription, /^acceptance criteria\b/i);
    const items = criteria
      ? listItems(criteria)
      : input.issueDescription
          .split(/\r?\n/)
          .map((l) => /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/.exec(l)?.[1]?.trim())
          .filter((s): s is string => Boolean(s));
    steps.push(...items.map((c) => `Confirm: ${c}`));
  }
  if (input.previewUrl) steps.push(`Open the preview at ${input.previewUrl} and exercise the change.`);
  if (input.prUrl) {
    steps.push(`Review the diff in ${input.prUrl}.`);
    steps.push("Check the PR's CI checks are green.");
  }
  return steps.slice(0, 20);
}

/**
 * The markdown summary: the agent's own closing message when it has one (what
 * changed and why, in its words), else the PR body. Trimmed — the full
 * transcript lives in Bob.
 */
export function deriveSummary(input: {
  agentSummary?: string | null;
  prTitle?: string | null;
  prBody?: string | null;
  prUrl?: string | null;
}): string {
  const base =
    [input.agentSummary, input.prBody, input.prTitle].map((v) => v?.trim()).find((v) => v) ??
    "Bob finished this work item.";
  const clipped = base.length > MAX_SUMMARY ? `${base.slice(0, MAX_SUMMARY - 1)}…` : base;
  return input.prUrl && !clipped.includes(input.prUrl) ? `${clipped}\n\nPull request: ${input.prUrl}` : clipped;
}

/**
 * `https://host/owner/repo/pulls/12` (Forgejo) or `.../pull/12` (GitHub) →
 * `https://host/owner/repo/commit/<sha>`. Null when the PR URL has another shape.
 */
export function commitUrlFor(prUrl: string, sha: string | null | undefined): string | null {
  if (!sha) return null;
  const m = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/pulls?\/\d+/.exec(prUrl);
  return m?.[1] ? `${m[1]}/commit/${sha}` : null;
}

// ---------------------------------------------------------------------------
// "Request changes" comments
// ---------------------------------------------------------------------------

/**
 * Kanbanger's Request-changes action adds a comment that starts with
 * `Changes requested:` followed by the reviewer's note. Returns the note (may be
 * empty when the reviewer left none), or null when the comment is not one.
 * Tolerates leading markdown emphasis (`**Changes requested:**`).
 */
export function parseChangesRequested(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = /^\s*(?:[*_]{1,2})?changes requested:(?:[*_]{1,2})?\s*([\s\S]*)$/i.exec(body);
  return m ? (m[1] ?? "").trim() : null;
}
