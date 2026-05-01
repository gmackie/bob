import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  alias,
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
} from "@gmacko/ooda/db";
import {
  CreateStandingInterestSchema,
  researchThread,
  threadLink,
  threadMemory,
} from "@gmacko/ooda/db/schema";

import { writeDraft } from "@gmacko/ooda/vault";

import { threadOwnerProcedure } from "../../middleware/thread-owner";
import {
  vaultScopedAuthedProcedure,
  vaultScopedProcedure,
} from "../../middleware/vault-scope";
import { publicProcedure } from "../../trpc";

export const interestsRouter = {
  /**
   * Triage queue for standing-interest findings. Thread-scoped in the
   * sense that findings from vault-global interests (where
   * `standing_interest.thread_id IS NULL`) are also included — those
   * apply to every thread in the vault.
   *
   * `triage = "all"` returns every triage state; otherwise filters to the
   * requested bucket.
   */
  inboxByThread: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/interests/inbox-by-thread", tags: ["research.interests"] } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        triage: z
          .enum(["pending", "saved", "dismissed", "promoted", "all"])
          .default("pending"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;

      // Scope: findings for this thread's own interests PLUS vault-global
      // interests (interest.thread_id IS NULL). The inner join against
      // standing_interest drops any orphan findings whose standingInterestId
      // no longer resolves — without the inner join, a LEFT JOIN would
      // produce standingInterest.threadId = NULL for both orphans AND
      // vault-global interests, conflating two very different cases.
      //
      // Orphans shouldn't normally exist (findings_inbox.standingInterestId
      // has ON DELETE CASCADE), but the inner join + the explicit
      // isNotNull guard defend against any future path that sets the
      // column to NULL directly.
      const threadFilter = or(
        eq(t.standingInterest.threadId, input.threadId),
        isNull(t.standingInterest.threadId),
      );

      const conditions = [
        isNotNull(t.findingsInbox.standingInterestId),
        threadFilter,
      ];
      if (input.triage !== "all") {
        conditions.push(eq(t.findingsInbox.triage, input.triage));
      }

      const rows = await ctx.db
        .select({
          id: t.findingsInbox.id,
          sourceId: t.findingsInbox.sourceId,
          title: t.sources.title,
          author: t.sources.author,
          sourceTs: t.sources.sourceTs,
          reasonMd: t.findingsInbox.reasonMd,
          score: t.findingsInbox.score,
          foundAt: t.findingsInbox.foundAt,
          triage: t.findingsInbox.triage,
          standingInterestLabel: t.standingInterest.label,
        })
        .from(t.findingsInbox)
        .innerJoin(t.sources, eq(t.sources.id, t.findingsInbox.sourceId))
        .innerJoin(
          t.standingInterest,
          eq(t.standingInterest.id, t.findingsInbox.standingInterestId),
        )
        .where(and(...conditions))
        .orderBy(desc(t.findingsInbox.foundAt))
        .limit(input.limit);

      return {
        items: rows.map((r) => ({
          id: r.id,
          sourceId: r.sourceId,
          title: r.title ?? null,
          author: r.author ?? null,
          year:
            r.sourceTs instanceof Date
              ? r.sourceTs.getUTCFullYear()
              : null,
          reasonMd: r.reasonMd ?? null,
          score: r.score ?? null,
          foundAt: r.foundAt,
          triage: r.triage,
          standingInterestLabel: r.standingInterestLabel ?? null,
        })),
      };
    }),

  /**
   * Cross-thread synergies — every `thread_link` where `threadId` is the
   * source OR target endpoint. The `otherThread{Id,Title}` fields always
   * describe the OTHER side so the dashboard doesn't have to flip them.
   */
  linksByThread: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/interests/links-by-thread", tags: ["research.interests"] } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      // Alias `researchThread` on each side of the OR so we can join it
      // twice (once for the from-endpoint, once for the to-endpoint) and
      // pick whichever side isn't the caller's thread.
      const fromThread = alias(researchThread, "from_thread");
      const toThread = alias(researchThread, "to_thread");

      const rows = await ctx.db
        .select({
          fromThreadId: threadLink.fromThreadId,
          toThreadId: threadLink.toThreadId,
          fromTitle: fromThread.title,
          toTitle: toThread.title,
          kind: threadLink.kind,
          score: threadLink.score,
          reasonMd: threadLink.reasonMd,
          discoveredAt: threadLink.discoveredAt,
        })
        .from(threadLink)
        .leftJoin(fromThread, eq(fromThread.id, threadLink.fromThreadId))
        .leftJoin(toThread, eq(toThread.id, threadLink.toThreadId))
        .where(
          or(
            eq(threadLink.fromThreadId, input.threadId),
            eq(threadLink.toThreadId, input.threadId),
          ),
        )
        .orderBy(desc(threadLink.discoveredAt))
        .limit(input.limit);

      return {
        items: rows.map((r) => {
          const isFrom = r.fromThreadId === input.threadId;
          return {
            otherThreadId: isFrom ? r.toThreadId : r.fromThreadId,
            otherThreadTitle: (isFrom ? r.toTitle : r.fromTitle) ?? null,
            kind: r.kind,
            score: r.score ?? null,
            reasonMd: r.reasonMd ?? null,
            discoveredAt: r.discoveredAt,
          };
        }),
      };
    }),

  // --- Task 4.3: inbox triage + standing-interest CRUD ------------------
  //
  // Write-side procedures that back the dashboard's inbox and interest
  // management panes. Same vault-scoping pattern as Task 4.2: procedures
  // use `vaultScopedProcedure` and read tables from `ctx.vaultTables`
  // (resolved by the vault-scope middleware).

  /**
   * Flag an inbox item as saved / dismissed / promoted. The actual KB
   * promotion flow (Task 4.4) is a separate procedure; this one just
   * records the triage decision and stamps `triageAt = now()` so the
   * dashboard can order "recently triaged" items.
   *
   * The external `action` wording ("save", "dismiss", "promote") is the
   * verb the user performed; the stored `triage` enum uses the past-tense
   * state ("saved", "dismissed", "promoted"). The small mapping below
   * bridges the two so callers don't have to think about the enum.
   */
  inboxTriage: vaultScopedAuthedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/interests/inbox-triage", tags: ["research.interests"], protect: true } })
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(["save", "dismiss", "promote"]),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const { findingsInbox } = ctx.vaultTables;
      const triage = (
        {
          save: "saved",
          dismiss: "dismissed",
          promote: "promoted",
        } as const
      )[input.action];
      const triageAt = new Date();

      const updated = await ctx.db
        .update(findingsInbox)
        .set({ triage, triageAt })
        .where(eq(findingsInbox.id, input.id))
        .returning({
          id: findingsInbox.id,
          triage: findingsInbox.triage,
          triageAt: findingsInbox.triageAt,
        });

      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `inbox item ${input.id} not found`,
        });
      }

      return { ok: true as const, ...updated[0]! };
    }),

  /**
   * Register a new standing interest. `CreateStandingInterestSchema`
   * already omits the server-controlled fields (id, lastRunAt, cursor,
   * lastError, autoDisableSuggested), so we pass it straight through and
   * let Drizzle fill in defaults on insert. The vault schema comes from
   * `ctx.vaultSchema` (Task 4.5 middleware).
   */
  interestRegister: vaultScopedAuthedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/interests/register", tags: ["research.interests"], protect: true } })
    .input(CreateStandingInterestSchema)
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const { standingInterest } = ctx.vaultTables;
      const rows = await ctx.db
        .insert(standingInterest)
        .values(input)
        .returning({
          id: standingInterest.id,
          label: standingInterest.label,
          cadenceSeconds: standingInterest.cadenceSeconds,
          enabled: standingInterest.enabled,
        });
      return rows[0]!;
    }),

  /**
   * List standing interests. When `threadId` is provided, returns
   * thread-scoped interests PLUS vault-global ones (`thread_id IS NULL`),
   * which apply across every thread in the vault. Without `threadId`,
   * returns every interest in the vault.
   *
   * Ordered enabled-first so the dashboard can render active interests
   * at the top of the list, with a stable label-alpha tiebreak.
   */
  interestList: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/interests/list", tags: ["research.interests"] } })
    .input(
      z.object({
        threadId: z.string().uuid().optional(),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const { standingInterest } = ctx.vaultTables;

      const whereClause = input.threadId
        ? or(
            eq(standingInterest.threadId, input.threadId),
            isNull(standingInterest.threadId),
          )
        : undefined;

      const rows = await ctx.db
        .select()
        .from(standingInterest)
        .where(whereClause)
        .orderBy(desc(standingInterest.enabled), asc(standingInterest.label));

      return { items: rows };
    }),

  /**
   * Partial update on a standing interest. Only the fields explicitly
   * supplied are patched — Zod-level validation enforces minimums
   * (cadence >= 300s prevents hammering the S2/OpenAlex backends).
   *
   * Empty patches are rejected so a buggy caller can't issue a no-op
   * UPDATE that still burns a DB round-trip + acquires a row lock.
   */
  interestUpdate: vaultScopedAuthedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/interests/update", tags: ["research.interests"], protect: true } })
    .input(
      z.object({
        id: z.string().uuid(),
        enabled: z.boolean().optional(),
        cadenceSeconds: z.number().int().min(300).optional(),
        queryTerms: z.array(z.string()).optional(),
        label: z.string().min(1).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const { standingInterest } = ctx.vaultTables;
      const { id, ...patch } = input;

      if (Object.keys(patch).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "no fields to update",
        });
      }

      const updated = await ctx.db
        .update(standingInterest)
        .set(patch)
        .where(eq(standingInterest.id, id))
        .returning();

      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `standing interest ${id} not found`,
        });
      }

      return updated[0]!;
    }),

  /**
   * Convenience shortcut: set `enabled = false` on a standing interest.
   * Equivalent to `interestUpdate({ id, enabled: false })` but saves the
   * dashboard from having to know the full update shape for a one-click
   * "pause this interest" action.
   */
  interestDisable: vaultScopedAuthedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/interests/disable", tags: ["research.interests"], protect: true } })
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const { standingInterest } = ctx.vaultTables;
      const updated = await ctx.db
        .update(standingInterest)
        .set({ enabled: false })
        .where(eq(standingInterest.id, input.id))
        .returning();

      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `standing interest ${input.id} not found`,
        });
      }

      return updated[0]!;
    }),

  // --- Task 4.4: KB promote draft ---------------------------------------
  //
  // Drafts a markdown note targeting a KB in the research vault as a
  // PR-style pending change. NEVER auto-commits — the file lives under
  // `<vault>/drafts/<kbSlug>/<id>.md` for a human to approve from the
  // dashboard. A later approval flow (out of scope here) moves the file
  // into `kbs/<slug>/` and commits.

  /**
   * Stage a draft KB note in the research vault. Returns the draft id +
   * in-vault path + status so the dashboard can render a diff preview
   * and offer an approve/reject action later.
   *
   * Fails with `PRECONDITION_FAILED` if `RESEARCH_VAULT_PATH` is unset —
   * drafts can only be written to a configured vault clone.
   */
  kbPromoteRequest: threadOwnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/interests/kb-promote", tags: ["research.interests"], protect: true } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        sourceIds: z.array(z.number().int()).min(1).max(50),
        // Must match the agent-facing schema in
        // packages/buddy-tools/src/schemas.ts (kb_promote_request). The regex
        // enforces a narrow filesystem-safe shape (lowercase, hyphens,
        // slashes) so the slug cannot escape drafts/<slug>/ via `..`.
        kbSlug: z
          .string()
          .min(1)
          .max(128)
          .regex(
            /^[a-z0-9][a-z0-9\-/]*$/,
            "kb slug: lowercase, hyphens, slashes",
          ),
        noteMd: z.string().min(1),
        createdByThreadId: z.string().uuid().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ input }) => {
      const vaultPath = process.env.RESEARCH_VAULT_PATH;
      if (!vaultPath || vaultPath.trim() === "") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Research vault is not configured. Set RESEARCH_VAULT_PATH in .env to the absolute path of your research vault git clone. See docs/SETUP.md#vaults.",
        });
      }

      const draft = await writeDraft(
        vaultPath,
        {
          kbSlug: input.kbSlug,
          sourceIds: input.sourceIds,
          ...(input.createdByThreadId !== undefined
            ? { createdByThreadId: input.createdByThreadId }
            : {}),
        },
        input.noteMd,
      );

      return {
        id: draft.id,
        relativePath: draft.relativePath,
        status: draft.status,
      };
    }),

  // --- Task 7.2: cold-thread updates (computed on the fly) --------------
  //
  // Computes updates for "cold" threads — threads whose rolling memory was
  // last touched more than 30 days ago — by joining `thread_memory` with
  // `findings_inbox` rows that arrived after the memory went cold. We do
  // NOT read a persisted `thread_link` row for this: the `cold_thread_update`
  // link kind was intentionally omitted from the enum (see
  // `research-buddy.ts`) so the dashboard doesn't have to wait for a
  // synergy-tick to surface news for a thread the user hasn't revisited.
  //
  // Topic-match strategy: `thread_memory.topic_fingerprint` is a text[] of
  // topic slugs; `standing_interest.query_terms` is a text[] of search
  // terms. When the fingerprint is populated, filter inbox rows to those
  // whose originating interest overlaps the fingerprint (array overlap via
  // `&&`). When the fingerprint is empty/null (early-life threads without
  // rollups yet), fall back to returning every pending inbox row that
  // post-dates the cold memory — documented V1.5 simplification so we
  // still surface *something* for a brand-new-but-then-abandoned thread.
  coldThreadUpdatesByThread: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/interests/cold-thread-updates", tags: ["research.interests"] } })
    .input(z.object({ threadId: z.string().uuid() }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const memoryRows = await ctx.db
        .select({
          updatedAt: threadMemory.updatedAt,
          topicFingerprint: threadMemory.topicFingerprint,
        })
        .from(threadMemory)
        .where(
          and(
            eq(threadMemory.threadId, input.threadId),
            lt(threadMemory.updatedAt, thirtyDaysAgo),
          ),
        )
        .limit(1);

      const memory = memoryRows[0];
      if (!memory) {
        return { items: [] };
      }

      const fingerprint = memory.topicFingerprint ?? [];
      const conditions = [
        gt(t.findingsInbox.foundAt, memory.updatedAt),
        eq(t.findingsInbox.triage, "pending"),
      ];
      if (fingerprint.length > 0) {
        // Only match findings whose originating interest overlaps the
        // thread's topic fingerprint. Vault-global interests (threadId IS
        // NULL) qualify iff their queryTerms overlap too.
        conditions.push(arrayOverlaps(t.standingInterest.queryTerms, fingerprint));
      }

      const rows = await ctx.db
        .select({
          sourceId: t.findingsInbox.sourceId,
          title: t.sources.title,
          foundAt: t.findingsInbox.foundAt,
          reasonMd: t.findingsInbox.reasonMd,
        })
        .from(t.findingsInbox)
        .innerJoin(t.sources, eq(t.sources.id, t.findingsInbox.sourceId))
        .leftJoin(
          t.standingInterest,
          eq(t.standingInterest.id, t.findingsInbox.standingInterestId),
        )
        .where(and(...conditions))
        .orderBy(desc(t.findingsInbox.foundAt))
        .limit(50);

      return {
        items: rows.map((r) => ({
          sourceId: r.sourceId,
          title: r.title ?? "",
          foundAt:
            r.foundAt instanceof Date ? r.foundAt.toISOString() : r.foundAt,
          reasonMd: r.reasonMd ?? "",
        })),
      };
    }),

  // --- Task 7.4: vault-wide reads for the /research landing page -------
  //
  // These mirror the thread-scoped reads above but drop the `threadId`
  // filter so the landing page can aggregate across every thread in the
  // vault. Same vault-scope middleware; nothing crosses vault boundaries.

  /**
   * Vault-wide triage queue: every `findings_inbox` row matching the
   * optional `triage` bucket and `since` lower bound, regardless of which
   * thread (if any) owns the originating interest. The dashboard uses
   * this to render "today's findings across all interests"; callers who
   * need thread scoping should use `inboxByThread` instead.
   */
  inboxVaultWide: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/interests/inbox-vault-wide", tags: ["research.interests"] } })
    .input(
      z.object({
        triage: z
          .enum(["pending", "saved", "dismissed", "promoted", "all"])
          .default("pending"),
        since: z.date().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;

      const triageCondition =
        input.triage !== "all"
          ? eq(t.findingsInbox.triage, input.triage)
          : undefined;
      const sinceCondition = input.since
        ? gte(t.findingsInbox.foundAt, input.since)
        : undefined;
      const conditions = [triageCondition, sinceCondition].filter(
        (c): c is Exclude<typeof triageCondition, undefined> =>
          c !== undefined,
      );

      const rows = await ctx.db
        .select({
          id: t.findingsInbox.id,
          sourceId: t.findingsInbox.sourceId,
          title: t.sources.title,
          author: t.sources.author,
          sourceTs: t.sources.sourceTs,
          reasonMd: t.findingsInbox.reasonMd,
          score: t.findingsInbox.score,
          foundAt: t.findingsInbox.foundAt,
          triage: t.findingsInbox.triage,
          standingInterestLabel: t.standingInterest.label,
        })
        .from(t.findingsInbox)
        .innerJoin(t.sources, eq(t.sources.id, t.findingsInbox.sourceId))
        .leftJoin(
          t.standingInterest,
          eq(t.standingInterest.id, t.findingsInbox.standingInterestId),
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(t.findingsInbox.foundAt))
        .limit(input.limit);

      return {
        items: rows.map((r) => ({
          id: r.id,
          sourceId: r.sourceId,
          title: r.title ?? null,
          author: r.author ?? null,
          year:
            r.sourceTs instanceof Date
              ? r.sourceTs.getUTCFullYear()
              : null,
          reasonMd: r.reasonMd ?? null,
          score: r.score ?? null,
          foundAt: r.foundAt,
          triage: r.triage,
          standingInterestLabel: r.standingInterestLabel ?? null,
        })),
      };
    }),
} satisfies RouterRecord;
