import type {
  PreflightApp,
  PreflightAppInput,
  PreflightClient,
  PreflightReleaseStatus,
} from "@gmacko/ooda/integrations";

export type PreflightClientConfig = {
  apiUrl: string;
  apiToken: string;
  fetch?: typeof fetch;
};

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function date(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function preflightApp(value: unknown): PreflightApp {
  const row = object(value, "Preflight returned an invalid app");
  const createdAt = date(row.createdAt);
  const updatedAt = date(row.updatedAt);
  if (
    typeof row.id !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.packageName !== "string" ||
    typeof row.packagePath !== "string" ||
    (row.defaultDistributionIntent !== "internal_only" &&
      row.defaultDistributionIntent !== "store_bound") ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("Preflight returned an invalid app");
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    packageName: row.packageName,
    packagePath: row.packagePath,
    defaultDistributionIntent: row.defaultDistributionIntent,
    createdAt,
    updatedAt,
    ...(row.appRuntime === "expo" || row.appRuntime === "unity"
      ? { appRuntime: row.appRuntime }
      : {}),
    ...(optionalText(row.forgeGraphAppId)
      ? { forgeGraphAppId: optionalText(row.forgeGraphAppId) }
      : {}),
    ...(optionalText(row.displayName)
      ? { displayName: optionalText(row.displayName) }
      : {}),
    ...(optionalText(row.expoSlug)
      ? { expoSlug: optionalText(row.expoSlug) }
      : {}),
    ...(optionalText(row.iosBundleId)
      ? { iosBundleId: optionalText(row.iosBundleId) }
      : {}),
    ...(optionalText(row.androidPackage)
      ? { androidPackage: optionalText(row.androidPackage) }
      : {}),
    ...(optionalText(row.easProjectId)
      ? { easProjectId: optionalText(row.easProjectId) }
      : {}),
  };
}

function releaseStatus(value: unknown): PreflightReleaseStatus {
  const row = object(value, "Preflight returned an invalid release status");
  const app = object(row.app, "Preflight returned an invalid release status");
  const stage = object(
    row.stage,
    "Preflight returned an invalid release status",
  );
  if (
    typeof app.id !== "string" ||
    !Array.isArray(app.platforms) ||
    (row.platform !== "ios" && row.platform !== "android") ||
    !Array.isArray(row.latestBuilds) ||
    !Array.isArray(row.submissions)
  ) {
    throw new Error("Preflight returned an invalid release status");
  }
  const next = stage.next;
  if (next !== null && (typeof next !== "object" || Array.isArray(next))) {
    throw new Error("Preflight returned an invalid release status");
  }
  return {
    app: {
      id: app.id,
      platforms: app.platforms.filter(
        (platform): platform is "ios" | "android" =>
          platform === "ios" || platform === "android",
      ),
    },
    platform: row.platform,
    stage: {
      current: typeof stage.current === "string" ? stage.current : null,
      next: next as PreflightReleaseStatus["stage"]["next"],
    },
    latestBuilds: row.latestBuilds,
    submissions: row.submissions.filter(
      (submission): submission is { status?: string } =>
        Boolean(submission) && typeof submission === "object",
    ),
    ...(row.buildHealth && typeof row.buildHealth === "object"
      ? {
          buildHealth: row.buildHealth as PreflightReleaseStatus["buildHealth"],
        }
      : {}),
  };
}

export function createPreflightClient(
  config: PreflightClientConfig,
): PreflightClient {
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
    const body = object(
      await response.json().catch(() => null),
      "Preflight returned an invalid response",
    );
    if (!response.ok) {
      const error = body.error;
      const detail =
        error && typeof error === "object" && !Array.isArray(error)
          ? optionalText((error as Record<string, unknown>).message)
          : undefined;
      const code =
        error && typeof error === "object" && !Array.isArray(error)
          ? optionalText((error as Record<string, unknown>).code)
          : undefined;
      const failure = new Error(
        `Preflight request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      ) as Error & { status?: number; code?: string };
      failure.status = response.status;
      failure.code = code;
      throw failure;
    }
    return body.data;
  }
  return {
    async listApps(workspaceId) {
      const query = new URLSearchParams({ workspaceId });
      const data = object(
        await request(`/api/preflight/v1/apps?${query}`),
        "Preflight returned an invalid app list",
      );
      if (!Array.isArray(data.apps)) {
        throw new Error("Preflight returned an invalid app list");
      }
      return data.apps.map(preflightApp);
    },
    async upsertApp(input: PreflightAppInput) {
      const data = object(
        await request("/api/preflight/v1/apps", {
          method: "POST",
          body: JSON.stringify(input),
        }),
        "Preflight returned an invalid app response",
      );
      return preflightApp(data.app);
    },
    async readReleaseStatus(appId, platform) {
      const query = new URLSearchParams({ platform });
      try {
        const data = object(
          await request(
            `/api/preflight/v1/apps/${encodeURIComponent(appId)}/release-status?${query}`,
          ),
          "Preflight returned an invalid release status",
        );
        return releaseStatus(data.releaseStatus);
      } catch (error) {
        const failure = error as { status?: number; code?: string };
        if (
          failure.status === 404 ||
          (failure.status === 400 && failure.code === "app_not_found")
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
