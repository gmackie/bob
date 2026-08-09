import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import superjson from "superjson";

import type { CreatorClient, CreatorProject } from "@gmacko/ooda/integrations";

export type CreatorClientConfig = {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

function creatorProject(value: unknown): CreatorProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Creator returned an invalid project");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    (row.sourceKind !== "local" && row.sourceKind !== "github") ||
    typeof row.status !== "string"
  ) {
    throw new Error("Creator returned an invalid project");
  }
  const createdAt =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : typeof row.createdAt === "string"
        ? row.createdAt
        : null;
  return {
    id: row.id,
    sourceKind: row.sourceKind,
    status: row.status,
    ...(typeof row.manifestId === "string" || row.manifestId === null
      ? { manifestId: row.manifestId }
      : {}),
    ...(typeof row.sourcePath === "string" || row.sourcePath === null
      ? { sourcePath: row.sourcePath }
      : {}),
    ...(typeof row.githubOwner === "string" || row.githubOwner === null
      ? { githubOwner: row.githubOwner }
      : {}),
    ...(typeof row.githubRepo === "string" || row.githubRepo === null
      ? { githubRepo: row.githubRepo }
      : {}),
    ...(typeof row.gitRef === "string" || row.gitRef === null
      ? { gitRef: row.gitRef }
      : {}),
    ...(typeof row.title === "string" || row.title === null
      ? { title: row.title }
      : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

export function createCreatorClient(
  config: CreatorClientConfig,
): CreatorClient {
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        url: `${config.apiUrl.replace(/\/+$/, "")}/api/trpc`,
        transformer: superjson,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        ...(config.fetch ? { fetch: config.fetch } : {}),
      }),
    ],
  });
  return {
    async listProjects() {
      const value = await client.query("video.list");
      if (!Array.isArray(value)) {
        throw new Error("Creator returned an invalid project list");
      }
      return value.map(creatorProject);
    },
    async registerLocalProject(projectPath) {
      return creatorProject(
        await client.mutation("video.register", {
          kind: "local",
          path: projectPath,
        }),
      );
    },
  };
}
