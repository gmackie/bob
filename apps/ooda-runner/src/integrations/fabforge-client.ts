import type {
  FabForgeCandidateWorkOrderInput,
  FabForgeClient,
  FabForgeWorkOrder,
} from "@gmacko/ooda/integrations";

export type FabForgeClientConfig = {
  apiUrl: string;
  apiToken: string;
  fetch?: typeof fetch;
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function workOrder(value: unknown): FabForgeWorkOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FabForge returned an invalid work order");
  }
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const workspaceId = text(row.workspaceId);
  const title = text(row.title);
  const status = text(row.status);
  const targetType = text(row.targetType);
  const groupingKey = text(row.groupingKey);
  const createdAt = text(row.createdAt);
  const updatedAt = text(row.updatedAt);
  if (
    !id ||
    !workspaceId ||
    !title ||
    !status ||
    !targetType ||
    !groupingKey ||
    !createdAt ||
    !updatedAt ||
    !Array.isArray(row.processTypes)
  ) {
    throw new Error("FabForge returned an invalid work order");
  }
  return {
    id,
    workspaceId,
    title,
    status,
    targetType,
    groupingKey,
    processTypes: row.processTypes.filter(
      (item): item is string => typeof item === "string",
    ),
    createdAt,
    updatedAt,
    ...(text(row.description) !== null || row.description === null
      ? { description: text(row.description) }
      : {}),
    ...(text(row.repositoryId) !== null || row.repositoryId === null
      ? { repositoryId: text(row.repositoryId) }
      : {}),
    ...(text(row.manualSourceKey) !== null || row.manualSourceKey === null
      ? { manualSourceKey: text(row.manualSourceKey) }
      : {}),
    ...(text(row.manifestPath) !== null || row.manifestPath === null
      ? { manifestPath: text(row.manifestPath) }
      : {}),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FabForge returned an invalid response");
  }
  return value as Record<string, unknown>;
}

export function createFabForgeClient(
  config: FabForgeClientConfig,
): FabForgeClient {
  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const fetcher = config.fetch ?? fetch;
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 1_000);
      throw new Error(
        `FabForge request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    return object(await response.json()).data;
  }
  return {
    async listWorkOrders(workspaceId) {
      const query = new URLSearchParams({ workspaceId });
      const data = object(
        await request(`/api/fabrication/v0/work-orders?${query}`),
      );
      if (!Array.isArray(data.workOrders)) {
        throw new Error("FabForge returned an invalid work-order list");
      }
      return data.workOrders.map(workOrder);
    },
    async createCandidateWorkOrder(input: FabForgeCandidateWorkOrderInput) {
      const data = object(
        await request("/api/fabrication/v0/candidate-work-orders", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
      return {
        created: data.created === true,
        workOrder: workOrder(data.workOrder),
      };
    },
  };
}
