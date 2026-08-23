import { isAbsolute } from "node:path";
import { z } from "zod";

import { writeFileOnce } from "@gmacko/ooda/vault";

const destinationSchema = z.enum(["gmacko", "obsidian", "substack"]);

const exportEnvelopeSchema = z.object({
  contractVersion: z.literal(1),
  kind: z.literal("weekly_editorial_export"),
  idempotencyKey: z.string().min(1),
  destination: z.object({
    name: destinationSchema,
    relativePath: z.string().min(1),
    scaffold: z.string(),
    writeMode: z.literal("create_or_verify_same_content"),
    autoPublishAllowed: z.literal(false),
  }),
  humanAuthorship: z.object({
    finalProseRequired: z.literal(true),
    humanApprovalRequiredForPublication: z.literal(true),
  }),
});

const claimSchema = z.object({
  deliveryId: z.uuid(),
  runId: z.uuid(),
  itemId: z.uuid(),
  destination: destinationSchema,
  claimToken: z.string().min(32),
  leaseExpiresAt: z.iso.datetime(),
  envelope: exportEnvelopeSchema,
});

const claimResponseSchema = z.object({ claims: z.array(claimSchema) });

export interface EditorialSyncOptions {
  apiUrl: string;
  apiKey: string;
  websitePath?: string;
  personalVaultPath?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}

export interface EditorialSyncResult {
  claimed: number;
  succeeded: number;
  failed: number;
  deliveries: {
    deliveryId: string;
    destination: z.infer<typeof destinationSchema>;
    status: "succeeded" | "failed";
    path?: string;
    error?: string;
  }[];
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error && typeof error === "object" && "json" in error) {
      const json = error.json;
      if (json && typeof json === "object" && "message" in json) {
        const message = json.message;
        if (typeof message === "string") return message;
      }
    }
  }
  return `BizPulse tRPC request failed with HTTP ${status}`;
}

async function trpcMutation(
  options: EditorialSyncOptions,
  procedure: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(
    `${options.apiUrl.replace(/\/+$/, "")}/api/trpc/${procedure}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: input }),
    },
  );
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  const parsed = z
    .object({ result: z.object({ data: z.object({ json: z.unknown() }) }) })
    .safeParse(body);
  if (!parsed.success) {
    throw new Error(`BizPulse returned an invalid response for ${procedure}`);
  }
  return parsed.data.result.data.json;
}

function destinationRoot(
  options: EditorialSyncOptions,
  destination: z.infer<typeof destinationSchema>,
): string {
  const root =
    destination === "gmacko" ? options.websitePath : options.personalVaultPath;
  if (!root) {
    const variable =
      destination === "gmacko"
        ? "PERSONAL_WEBSITE_PATH"
        : "PERSONAL_VAULT_PATH";
    throw new Error(`${variable} is required for ${destination} exports`);
  }
  if (!isAbsolute(root)) {
    throw new Error(`${destination} export root must be an absolute path`);
  }
  return root;
}

function safeError(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Unknown export error"
  ).slice(0, 2000);
}

export async function runEditorialSync(
  options: EditorialSyncOptions,
): Promise<EditorialSyncResult> {
  if (!options.apiKey.trim()) throw new Error("BIZPULSE_API_KEY is required");
  const claimResult = claimResponseSchema.parse(
    await trpcMutation(options, "weeklyReview.claimEditorialExports", {
      limit: options.limit ?? 10,
      leaseMinutes: 30,
      destinations: ["gmacko", "obsidian", "substack"],
    }),
  );
  const result: EditorialSyncResult = {
    claimed: claimResult.claims.length,
    succeeded: 0,
    failed: 0,
    deliveries: [],
  };

  for (const claim of claimResult.claims) {
    const envelope = claim.envelope;
    try {
      if (envelope.destination.name !== claim.destination) {
        throw new Error("Claim destination does not match its export envelope");
      }
      const root = destinationRoot(options, claim.destination);
      const writeStatus = await writeFileOnce(
        root,
        envelope.destination.relativePath,
        envelope.destination.scaffold,
      );
      await trpcMutation(options, "weeklyReview.recordEditorialExportReceipt", {
        deliveryId: claim.deliveryId,
        claimToken: claim.claimToken,
        outcome: "succeeded",
        externalId: envelope.idempotencyKey,
        externalPath: envelope.destination.relativePath,
        metadata: {
          executor: "ooda-editorial-sync-v1",
          writeStatus,
          finalProseRequired: true,
          autoPublishAllowed: false,
        },
      });
      result.succeeded += 1;
      result.deliveries.push({
        deliveryId: claim.deliveryId,
        destination: claim.destination,
        status: "succeeded",
        path: envelope.destination.relativePath,
      });
    } catch (error) {
      const message = safeError(error);
      try {
        await trpcMutation(
          options,
          "weeklyReview.recordEditorialExportReceipt",
          {
            deliveryId: claim.deliveryId,
            claimToken: claim.claimToken,
            outcome: "failed",
            error: message,
            metadata: { executor: "ooda-editorial-sync-v1" },
          },
        );
      } catch (receiptError) {
        throw new Error(
          `${message}; failed to record BizPulse receipt: ${safeError(receiptError)}`,
        );
      }
      result.failed += 1;
      result.deliveries.push({
        deliveryId: claim.deliveryId,
        destination: claim.destination,
        status: "failed",
        error: message,
      });
    }
  }

  await trpcMutation(
    options,
    "weeklyReview.reportEditorialExecutorHeartbeat",
    {},
  );

  return result;
}
