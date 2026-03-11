import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveForgeObjectStorageUrl } from "@linear-clone/storage";

const FORGE_STORAGE_FETCH_TIMEOUT_MS = 8000;
const FORGE_STORAGE_TIMEOUT_ERROR = "ForgeGraphStorageTimeoutError";

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  return raw === "1" || raw.toLowerCase() === "true";
}

function sanitizePath(pathSegments: string[]): string {
  return pathSegments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "..")
    .join("/");
}

function buildUpstreamUrl(objectPath: string): string | null {
  const publicBase = process.env.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL ?? "";

  const resolvedFromPublicUrl = resolveForgeObjectStorageUrl({
    storageBackend: "s3",
    storagePrefix: "",
    storageKey: objectPath,
    endpoint: process.env.FORGEGRAPH_STORAGE_ENDPOINT,
    bucket: process.env.FORGEGRAPH_STORAGE_BUCKET,
    usePathStyle: getBooleanEnv("FORGEGRAPH_STORAGE_USE_PATH_STYLE", true),
    publicBaseUrl: publicBase,
  });

  if (resolvedFromPublicUrl) {
    try {
      const parsed = new URL(resolvedFromPublicUrl);
      if (parsed.pathname.startsWith("/api/forge-storage")) {
        return resolveForgeObjectStorageUrl({
          storageBackend: "s3",
          storagePrefix: "",
          storageKey: objectPath,
          endpoint: process.env.FORGEGRAPH_STORAGE_ENDPOINT,
          bucket: process.env.FORGEGRAPH_STORAGE_BUCKET,
          usePathStyle: getBooleanEnv("FORGEGRAPH_STORAGE_USE_PATH_STYLE", true),
          publicBaseUrl: "",
        });
      }
    } catch {
      // If the public URL is malformed, fall through to the raw resolver.
    }
  }

  if (resolvedFromPublicUrl) {
    return resolvedFromPublicUrl;
  }

  return resolveForgeObjectStorageUrl({
    storageBackend: "s3",
    storagePrefix: "",
    storageKey: objectPath,
    endpoint: process.env.FORGEGRAPH_STORAGE_ENDPOINT,
    bucket: process.env.FORGEGRAPH_STORAGE_BUCKET,
    usePathStyle: getBooleanEnv("FORGEGRAPH_STORAGE_USE_PATH_STYLE", true),
    publicBaseUrl: "",
  });
}

function headersForUpstream(upstream: Response): HeadersInit {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") {
      return;
    }

    headers.set(key, value);
  });

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, max-age=3600");
  }

  return headers;
}

class ForgeStorageTimeoutError extends Error {
  constructor() {
    super("Storage fetch timed out");
    this.name = FORGE_STORAGE_TIMEOUT_ERROR;
  }
}

function isTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === FORGE_STORAGE_TIMEOUT_ERROR;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ForgeStorageTimeoutError());
    }, FORGE_STORAGE_FETCH_TIMEOUT_MS);
  });

  return Promise.race([fetch(url, { cache: "no-store" }), timeoutPromise]);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const objectPath = sanitizePath(path ?? []);
  if (!objectPath) {
    return NextResponse.json(
      { error: "Missing storage object path" },
      { status: 400 }
    );
  }

  const upstreamUrl = buildUpstreamUrl(objectPath);
  if (!upstreamUrl) {
    return NextResponse.json(
      { error: "Storage endpoint is not configured" },
      { status: 500 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(upstreamUrl);
  } catch (error) {
    if (isTimeoutError(error)) {
      return NextResponse.json(
        { error: "Timed out while fetching storage object" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: "Failed to load artifact" },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Failed to load artifact", status: upstream.status, upstreamStatusText: upstream.statusText },
      { status: upstream.status }
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: headersForUpstream(upstream),
  });
}
