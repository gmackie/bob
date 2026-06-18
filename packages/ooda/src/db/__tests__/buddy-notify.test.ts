/**
 * Integration test for the buddy LISTEN/NOTIFY triggers defined in
 * `drizzle/custom/001_buddy_notify.sql`.
 *
 * Requires a live Postgres with the schema + custom triggers applied:
 *   pnpm db:push   (which now chains migrate:custom)
 *
 * Skipped automatically when DATABASE_URL is unset (e.g., in the sandbox /
 * lint-only CI lane) so the suite stays green without a DB.
 */
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DATABASE_URL);

type Sql = ReturnType<typeof postgres>;

/**
 * Register a LISTEN on `channel` and return a Promise that resolves with the
 * first received payload. Awaits the LISTEN registration handshake with the
 * server before returning, so the caller can safely issue writes and know the
 * subsequent NOTIFY won't be lost.
 */
async function setupListener(
  listener: Sql,
  channel: string,
  timeoutMs = 5_000,
): Promise<Promise<string>> {
  let resolvePayload!: (p: string) => void;
  let rejectPayload!: (e: unknown) => void;
  const received = new Promise<string>((resolve, reject) => {
    resolvePayload = resolve;
    rejectPayload = reject;
  });
  const timer = setTimeout(
    () => rejectPayload(new Error(`Timed out waiting for NOTIFY on ${channel}`)),
    timeoutMs,
  );
  // postgres.js listen() returns a Promise that resolves only after the
  // LISTEN command has been acknowledged by the server. Awaiting it here is
  // the fix for the M2 race: we must not INSERT before the subscription is
  // live, or the NOTIFY fires into the void and the test times out.
  await listener.listen(channel, (payload) => {
    clearTimeout(timer);
    resolvePayload(payload);
  });
  return received;
}

describe.skipIf(!HAS_DB)("buddy pg_notify triggers", () => {
  it(
    "fires buddy_tool_call on insert to tool_call_log",
    async () => {
      const listener = postgres(DATABASE_URL!, { max: 1 });
      const writer = postgres(DATABASE_URL!, { max: 1 });
      try {
        const received = await setupListener(listener, "buddy_tool_call");

        const [thread] = await writer<{ id: string }[]>`
          INSERT INTO research_thread (id, slug, title, status)
          VALUES (gen_random_uuid(), ${`test-buddy-notify-${Date.now()}`}, 'test buddy notify', 'active')
          RETURNING id
        `;
        const threadId = thread!.id;

        try {
          await writer`
            INSERT INTO tool_call_log (id, thread_id, tool_name, args)
            VALUES (gen_random_uuid(), ${threadId}, ${"test_tool"}, ${writer.json({ foo: "bar" })})
          `;

          const raw = await received;
          const payload = JSON.parse(raw) as {
            tool_name: string;
            op: string;
            thread_id: string;
          };
          expect(payload.tool_name).toBe("test_tool");
          expect(payload.op).toBe("INSERT");
          expect(payload.thread_id).toBe(threadId);
        } finally {
          await writer`DELETE FROM research_thread WHERE id = ${threadId}`;
        }
      } finally {
        await listener.end({ timeout: 5 });
        await writer.end({ timeout: 5 });
      }
    },
    10_000,
  );

  it(
    "fires buddy_dive_update on INSERT and UPDATE to graph_exploration",
    async () => {
      const listener = postgres(DATABASE_URL!, { max: 1 });
      const writer = postgres(DATABASE_URL!, { max: 1 });
      try {
        // First round: capture the INSERT notification.
        const insertReceived = await setupListener(
          listener,
          "buddy_dive_update",
        );

        const [thread] = await writer<{ id: string }[]>`
          INSERT INTO research_thread (id, slug, title, status)
          VALUES (gen_random_uuid(), ${`test-buddy-dive-${Date.now()}`}, 'test buddy dive', 'active')
          RETURNING id
        `;
        const threadId = thread!.id;

        try {
          const [exploration] = await writer<{ id: string }[]>`
            INSERT INTO graph_exploration (id, thread_id, seed, status)
            VALUES (gen_random_uuid(), ${threadId}, ${writer.array(["seed-paper"])}, 'queued')
            RETURNING id
          `;
          const explorationId = exploration!.id;

          const insertRaw = await insertReceived;
          const insertPayload = JSON.parse(insertRaw) as {
            thread_id: string;
            status: string;
            op: string;
          };
          expect(insertPayload.thread_id).toBe(threadId);
          expect(insertPayload.status).toBe("queued");
          expect(insertPayload.op).toBe("INSERT");

          // Second round: capture the UPDATE notification on a fresh listener
          // so we don't race the already-resolved Promise.
          const updateListener = postgres(DATABASE_URL!, { max: 1 });
          try {
            const updateReceived = await setupListener(
              updateListener,
              "buddy_dive_update",
            );
            await writer`
              UPDATE graph_exploration SET status = 'done' WHERE id = ${explorationId}
            `;
            const updateRaw = await updateReceived;
            const updatePayload = JSON.parse(updateRaw) as {
              thread_id: string;
              status: string;
              op: string;
            };
            expect(updatePayload.thread_id).toBe(threadId);
            expect(updatePayload.status).toBe("done");
            expect(updatePayload.op).toBe("UPDATE");
          } finally {
            await updateListener.end({ timeout: 5 });
          }
        } finally {
          // Cascade cleans up graph_exploration rows via thread FK.
          await writer`DELETE FROM research_thread WHERE id = ${threadId}`;
        }
      } finally {
        await listener.end({ timeout: 5 });
        await writer.end({ timeout: 5 });
      }
    },
    10_000,
  );

  it(
    "fires buddy_inbox_new on insert to research_vault.findings_inbox",
    async () => {
      const listener = postgres(DATABASE_URL!, { max: 1 });
      const writer = postgres(DATABASE_URL!, { max: 1 });
      try {
        const received = await setupListener(listener, "buddy_inbox_new");

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const [source] = await writer<{ id: number }[]>`
          INSERT INTO research_vault.sources (kind, external_id, title, body, content_hash)
          VALUES ('file', ${`test-ext-${suffix}`}, 'test buddy inbox', 'body', ${`hash-${suffix}`})
          RETURNING id
        `;
        const sourceId = source!.id;

        try {
          const [inbox] = await writer<{ id: string }[]>`
            INSERT INTO research_vault.findings_inbox (source_id)
            VALUES (${sourceId})
            RETURNING id
          `;
          const inboxId = inbox!.id;

          try {
            const raw = await received;
            const payload = JSON.parse(raw) as {
              vault: string;
              source_id: number;
              op: string;
            };
            expect(payload.vault).toBe("research_vault");
            expect(payload.source_id).toBe(sourceId);
            expect(payload.op).toBe("INSERT");
          } finally {
            await writer`DELETE FROM research_vault.findings_inbox WHERE id = ${inboxId}`;
          }
        } finally {
          await writer`DELETE FROM research_vault.sources WHERE id = ${sourceId}`;
        }
      } finally {
        await listener.end({ timeout: 5 });
        await writer.end({ timeout: 5 });
      }
    },
    10_000,
  );

  it(
    "fires buddy_inbox_new on insert to personal_vault.findings_inbox",
    async () => {
      const listener = postgres(DATABASE_URL!, { max: 1 });
      const writer = postgres(DATABASE_URL!, { max: 1 });
      try {
        const received = await setupListener(listener, "buddy_inbox_new");

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const [source] = await writer<{ id: number }[]>`
          INSERT INTO personal_vault.sources (kind, external_id, title, body, content_hash)
          VALUES ('file', ${`test-ext-${suffix}`}, 'test buddy inbox personal', 'body', ${`hash-${suffix}`})
          RETURNING id
        `;
        const sourceId = source!.id;

        try {
          const [inbox] = await writer<{ id: string }[]>`
            INSERT INTO personal_vault.findings_inbox (source_id)
            VALUES (${sourceId})
            RETURNING id
          `;
          const inboxId = inbox!.id;

          try {
            const raw = await received;
            const payload = JSON.parse(raw) as {
              vault: string;
              source_id: number;
              op: string;
            };
            expect(payload.vault).toBe("personal_vault");
            expect(payload.source_id).toBe(sourceId);
            expect(payload.op).toBe("INSERT");
          } finally {
            await writer`DELETE FROM personal_vault.findings_inbox WHERE id = ${inboxId}`;
          }
        } finally {
          await writer`DELETE FROM personal_vault.sources WHERE id = ${sourceId}`;
        }
      } finally {
        await listener.end({ timeout: 5 });
        await writer.end({ timeout: 5 });
      }
    },
    10_000,
  );
});
