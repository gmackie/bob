import {
  createTRPCUntypedClient,
  httpLink,
  TRPCClientError,
} from "@trpc/client";
import superjson from "superjson";

import type { VeritasClient, VeritasProject } from "@gmacko/ooda/integrations";

export type VeritasClientConfig = {
  apiUrl: string;
  apiToken: string;
  fetch?: typeof fetch;
};

function date(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function veritasProject(value: unknown): VeritasProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Veritas returned an invalid project");
  }
  const row = value as Record<string, unknown>;
  const createdAt = date(row.createdAt);
  const updatedAt = date(row.updatedAt);
  if (
    typeof row.id !== "string" ||
    typeof row.orgId !== "string" ||
    typeof row.name !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.firmwareRepoUrl !== "string" ||
    typeof row.autoValidate !== "boolean" ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("Veritas returned an invalid project");
  }
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    firmwareRepoUrl: row.firmwareRepoUrl,
    autoValidate: row.autoValidate,
    createdAt,
    updatedAt,
    ...(nullableText(row.description) !== undefined
      ? { description: nullableText(row.description) }
      : {}),
    ...(nullableText(row.pcbRepoUrl) !== undefined
      ? { pcbRepoUrl: nullableText(row.pcbRepoUrl) }
      : {}),
    ...(nullableText(row.targetHardware) !== undefined
      ? { targetHardware: nullableText(row.targetHardware) }
      : {}),
  };
}

function projectEnvelope(value: unknown): VeritasProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Veritas returned an invalid response");
  }
  return veritasProject((value as Record<string, unknown>).project);
}

export function createVeritasClient(
  config: VeritasClientConfig,
): VeritasClient {
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        url: `${config.apiUrl.replace(/\/+$/, "")}/api/trpc`,
        transformer: superjson,
        headers: { Authorization: `Bearer ${config.apiToken}` },
        ...(config.fetch ? { fetch: config.fetch } : {}),
      }),
    ],
  });
  return {
    async listProjects(search) {
      const value = await client.query("projects.list", {
        ...(search ? { search } : {}),
        limit: 100,
      });
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Veritas returned an invalid project list");
      }
      const rows = (value as Record<string, unknown>).projects;
      if (!Array.isArray(rows)) {
        throw new Error("Veritas returned an invalid project list");
      }
      return rows.map(veritasProject);
    },
    async getProject(id) {
      try {
        return projectEnvelope(await client.query("projects.get", { id }));
      } catch (error) {
        if (
          error instanceof TRPCClientError &&
          error.data?.code === "NOT_FOUND"
        ) {
          return null;
        }
        throw error;
      }
    },
    async createProject(input) {
      return projectEnvelope(await client.mutation("projects.create", input));
    },
  };
}
