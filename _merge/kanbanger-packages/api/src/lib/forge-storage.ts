import { resolveForgeObjectStorageUrl } from "@linear-clone/storage";

type ArtifactMetadata = Record<string, unknown> | null | undefined;

export type ForgeArtifactMetadataResolverInput = {
  storageBackend: string | null;
  storagePrefix: string;
  storageKey: string;
  metadata?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveArtifactMetadataUrl(
  params: ForgeArtifactMetadataResolverInput
): ArtifactMetadata {
  const { storageBackend, storagePrefix, storageKey, metadata } = params;
  const resolvedUrl = resolveForgeObjectStorageUrl({
    storageBackend,
    storagePrefix,
    storageKey,
    metadataUrl: metadata,
  });

  if (!resolvedUrl) {
    return metadata === null ? null : (metadata as ArtifactMetadata);
  }

  const metadataRecord = isRecord(metadata) ? (metadata as ArtifactMetadata) : {};

  if (!metadataRecord) {
    return { url: resolvedUrl };
  }

  return {
    ...metadataRecord,
    url: resolvedUrl,
  };
}
