import { getDomainPack } from "./packs";

export interface DomainPackTemplate {
  sourceBundleIds: string[];
  warnings: string[];
  systemPromptAddendum: string;
  defaultToolProfileId: string;
}

export function getDomainPackTemplate(
  packId: string,
): DomainPackTemplate | undefined {
  const pack = getDomainPack(packId);
  if (!pack) return undefined;

  return {
    sourceBundleIds: [...pack.sourceBundleIds],
    warnings: [...pack.warnings],
    systemPromptAddendum: pack.systemPromptAddendum,
    defaultToolProfileId: pack.defaultToolProfileId,
  };
}
