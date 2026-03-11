import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveArtifactMetadataUrl } from "../src/lib/forge-storage";
import { resolveForgeObjectStorageUrl } from "@linear-clone/storage";

function withForgeEnv(values: Record<string, string | undefined>) {
  const previous = {
    FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: process.env.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL,
    FORGEGRAPH_STORAGE_ENDPOINT: process.env.FORGEGRAPH_STORAGE_ENDPOINT,
    FORGEGRAPH_STORAGE_BUCKET: process.env.FORGEGRAPH_STORAGE_BUCKET,
    FORGEGRAPH_STORAGE_USE_PATH_STYLE: process.env.FORGEGRAPH_STORAGE_USE_PATH_STYLE,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    if (previous.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL === undefined) {
      delete process.env.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL;
    } else {
      process.env.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL = previous.FORGEGRAPH_STORAGE_PUBLIC_BASE_URL;
    }

    if (previous.FORGEGRAPH_STORAGE_ENDPOINT === undefined) {
      delete process.env.FORGEGRAPH_STORAGE_ENDPOINT;
    } else {
      process.env.FORGEGRAPH_STORAGE_ENDPOINT = previous.FORGEGRAPH_STORAGE_ENDPOINT;
    }

    if (previous.FORGEGRAPH_STORAGE_BUCKET === undefined) {
      delete process.env.FORGEGRAPH_STORAGE_BUCKET;
    } else {
      process.env.FORGEGRAPH_STORAGE_BUCKET = previous.FORGEGRAPH_STORAGE_BUCKET;
    }

    if (previous.FORGEGRAPH_STORAGE_USE_PATH_STYLE === undefined) {
      delete process.env.FORGEGRAPH_STORAGE_USE_PATH_STYLE;
    } else {
      process.env.FORGEGRAPH_STORAGE_USE_PATH_STYLE = previous.FORGEGRAPH_STORAGE_USE_PATH_STYLE;
    }
  };
}

beforeEach(() => {
  process.env.FORGEGRAPH_STORAGE_USE_PATH_STYLE = "1";
});

afterEach(() => {
  delete process.env.FORGEGRAPH_STORAGE_USE_PATH_STYLE;
});

describe("resolveForgeObjectStorageUrl", () => {
  it("uses metadata URL when valid", () => {
    const restore = withForgeEnv({ FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: "https://public.example.com" });

    try {
      expect(
        resolveForgeObjectStorageUrl({
          storageBackend: "s3",
          storagePrefix: "repoA",
          storageKey: "artifacts/log.txt",
          metadataUrl: { url: "https://trusted.example.com/a.bin" },
        })
      ).toBe("https://trusted.example.com/a.bin");
    } finally {
      restore();
    }
  });

  it("builds public URLs with encoded object path", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: "https://artifacts.example.com",
      FORGEGRAPH_STORAGE_ENDPOINT: "https://minio.internal:9000",
    });

    try {
      expect(
        resolveForgeObjectStorageUrl({
          storageBackend: "s3",
          storagePrefix: "repo A",
          storageKey: "artifacts/test log.txt",
        })
      ).toBe("https://artifacts.example.com/repo%20A/artifacts/test%20log.txt");
    } finally {
      restore();
    }
  });

  it("builds s3-style URLs from endpoint and bucket", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_ENDPOINT: "https://minio.internal:9000",
      FORGEGRAPH_STORAGE_BUCKET: "forge-bucket",
    });

    try {
      expect(
        resolveForgeObjectStorageUrl({
          storageBackend: "s3",
          storagePrefix: "repoA/",
          storageKey: "/artifacts/test.txt",
        })
      ).toBe("https://minio.internal:9000/forge-bucket/repoA/artifacts/test.txt");
    } finally {
      restore();
    }
  });

  it("builds virtual-host URLs when path-style is disabled", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_ENDPOINT: "https://minio.internal:9000",
      FORGEGRAPH_STORAGE_BUCKET: "forge-bucket",
      FORGEGRAPH_STORAGE_USE_PATH_STYLE: "false",
    });

    try {
      expect(
        resolveForgeObjectStorageUrl({
          storageBackend: "s3",
          storagePrefix: "repoA",
          storageKey: "artifacts/test.txt",
        })
      ).toBe("https://forge-bucket.minio.internal:9000/repoA/artifacts/test.txt");
    } finally {
      restore();
    }
  });
});

describe("resolveArtifactMetadataUrl", () => {
  it("preserves explicit metadata object and preserves valid url", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: "https://artifacts.example.com",
    });

    try {
      const output = resolveArtifactMetadataUrl({
        storageBackend: "s3",
        storagePrefix: "repoA",
        storageKey: "artifacts/test.txt",
        metadata: {
          url: "https://trusted.example.com/custom.bin",
          name: "override.bin",
        },
      });

      expect(output).toEqual({
        url: "https://trusted.example.com/custom.bin",
        name: "override.bin",
      });
    } finally {
      restore();
    }
  });

  it("adds generated URL when metadata only has non-url values", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: "https://artifacts.example.com",
    });

    try {
      const output = resolveArtifactMetadataUrl({
        storageBackend: "s3",
        storagePrefix: "repoA",
        storageKey: "artifacts/test.txt",
        metadata: {
          name: "build-log.txt",
        },
      });

      expect(output).toEqual({
        name: "build-log.txt",
        url: "https://artifacts.example.com/repoA/artifacts/test.txt",
      });
    } finally {
      restore();
    }
  });

  it("returns null when metadata is null and URL cannot be resolved", () => {
    const restore = withForgeEnv({});
    try {
      expect(
        resolveArtifactMetadataUrl({
          storageBackend: "s3",
          storagePrefix: "repoA",
          storageKey: "artifacts/test.txt",
          metadata: null,
        })
      ).toBeNull();
    } finally {
      restore();
    }
  });

  it("falls back from invalid metadata url to generated URL", () => {
    const restore = withForgeEnv({
      FORGEGRAPH_STORAGE_PUBLIC_BASE_URL: "https://artifacts.example.com",
    });

    try {
      const output = resolveArtifactMetadataUrl({
        storageBackend: "s3",
        storagePrefix: "repoA",
        storageKey: "artifacts/test.txt",
        metadata: {
          url: "not-a-url",
        },
      });

      expect(output).toEqual({
        url: "https://artifacts.example.com/repoA/artifacts/test.txt",
      });
    } finally {
      restore();
    }
  });
});
