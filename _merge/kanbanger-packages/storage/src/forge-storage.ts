export type ForgeStorageBackend = "s3" | "rsync";

export type ForgeObjectStorageInput = {
  storageBackend: string | null | undefined;
  storagePrefix: string;
  storageKey: string;
  metadataUrl?: unknown;
  publicBaseUrl?: string;
  endpoint?: string;
  bucket?: string;
  usePathStyle?: boolean;
};

export function resolveForgeObjectStorageUrl(input: ForgeObjectStorageInput): string | null {
  const backend = isSupportedBackend(input.storageBackend) ? input.storageBackend : "s3";

  const metadataUrl = resolveMetadataUrl(input.metadataUrl);
  if (metadataUrl) {
    return metadataUrl;
  }

  const objectPath = normalizeStoragePath(`${input.storagePrefix}/${input.storageKey}`);

  if (!objectPath || backend === "rsync") {
    return null;
  }

  const publicBaseUrl = getEnv("FORGEGRAPH_STORAGE_PUBLIC_BASE_URL", input.publicBaseUrl);
  if (publicBaseUrl) {
    return `${trimTrailingSlash(publicBaseUrl)}/${encodeStoragePath(objectPath)}`;
  }

  const endpoint = getEnv("FORGEGRAPH_STORAGE_ENDPOINT", input.endpoint);
  const bucket = getEnv("FORGEGRAPH_STORAGE_BUCKET", input.bucket);
  const usePathStyle = input.usePathStyle ?? getBooleanEnv("FORGEGRAPH_STORAGE_USE_PATH_STYLE", true);

  if (!endpoint || !bucket) {
    return null;
  }

  try {
    const parsed = new URL(endpoint);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (usePathStyle) {
      parsed.pathname = normalizeUrlPath(
        combinePath(parsed.pathname, bucket, objectPath)
      );
      return parsed.toString();
    }

    parsed.pathname = normalizeUrlPath(combinePath("", objectPath));
    parsed.hostname = `${bucket}.${parsed.hostname}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveMetadataUrl(candidate: unknown): string | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const maybeUrl = candidate.url;
  if (typeof maybeUrl !== "string" || !maybeUrl.trim()) {
    return undefined;
  }

  try {
    return new URL(maybeUrl).toString();
  } catch {
    return undefined;
  }
}

function isSupportedBackend(value: string | null | undefined): value is ForgeStorageBackend {
  return value === "s3" || value === "rsync";
}

function getEnv(name: string, overrideValue?: string): string {
  const value = overrideValue ?? process.env[name] ?? "";
  return value.trim();
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  return raw === "1" || raw.toLowerCase() === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoragePath(value: string): string {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function encodeStoragePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function combinePath(...parts: string[]): string {
  return parts
    .flatMap((part) => normalizeStoragePath(part).split("/"))
    .filter(Boolean)
    .join("/");
}

function normalizeUrlPath(path: string): string {
  const normalized = path
    .split("/")
    .filter(Boolean)
    .join("/");
  return normalized ? `/${normalized}` : "/";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
