import { createTRPCClient, httpLink } from "@trpc/client";
import type {
  BizPulseClient,
  BizPulseCreateStartupInput,
  BizPulseStartup,
} from "@gmacko/ooda/integrations";
import superjson from "superjson";

export type CreateBizPulseClientOptions = {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

type BizPulseTrpcClient = {
  startup: {
    list: { query(): Promise<unknown> };
    bySlug: { query(input: { slug: string }): Promise<unknown> };
    create: { mutate(input: BizPulseCreateStartupInput): Promise<unknown> };
  };
};

function startup(value: unknown): BizPulseStartup {
  if (!value || typeof value !== "object")
    throw new Error("BizPulse returned an invalid startup");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.portfolioRole !== "string" ||
    typeof row.lifecycleStage !== "string" ||
    (typeof row.createdAt !== "string" && !(row.createdAt instanceof Date))
  ) {
    throw new Error("BizPulse returned an invalid startup");
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    portfolioRole: row.portfolioRole,
    lifecycleStage: row.lifecycleStage,
    operatorNotes:
      typeof row.operatorNotes === "string" ? row.operatorNotes : null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
  };
}

export function createBizPulseClient(
  options: CreateBizPulseClientOptions,
): BizPulseClient {
  const baseUrl = options.apiUrl.replace(/\/+$/, "");
  const client = createTRPCClient<any>({
    links: [
      httpLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        fetch: options.fetch,
        headers: () => ({
          Authorization: `Bearer ${options.apiKey}`,
          "X-API-Version": "v1",
          "X-TRPC-Source": "ooda-runner",
        }),
      }),
    ],
  }) as unknown as BizPulseTrpcClient;

  return {
    async listStartups() {
      const rows = (await client.startup.list.query()) as unknown;
      if (!Array.isArray(rows))
        throw new Error("BizPulse returned an invalid startup list");
      return rows.map(startup);
    },
    async getStartupBySlug(slug) {
      try {
        return startup(await client.startup.bySlug.query({ slug }));
      } catch (error) {
        const data = (error as { data?: { code?: string } }).data;
        if (data?.code === "NOT_FOUND") return null;
        throw error;
      }
    },
    async createStartup(input: BizPulseCreateStartupInput) {
      return startup(await client.startup.create.mutate(input));
    },
  };
}
