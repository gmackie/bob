import { z } from "zod";

export const DomainPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sourceBundleIds: z.array(z.string()),
  defaultToolProfileId: z.string(),
  warnings: z.array(z.string()),
  systemPromptAddendum: z.string(),
});

export type DomainPack = z.infer<typeof DomainPackSchema>;

const DOMAIN_PACKS: DomainPack[] = [
  {
    id: "general-research",
    name: "General Research",
    description: "General-purpose research across diverse topics",
    sourceBundleIds: ["general-research"],
    defaultToolProfileId: "research-light",
    warnings: [],
    systemPromptAddendum:
      "You are a research assistant. Focus on finding high-quality sources and synthesizing information.",
  },
  {
    id: "technical-research",
    name: "Technical Research",
    description: "Software engineering, systems, and technical topics",
    sourceBundleIds: ["general-research", "technical-literature"],
    defaultToolProfileId: "research-light",
    warnings: [],
    systemPromptAddendum:
      "You are a technical research assistant. Prioritize primary sources, official docs, and peer-reviewed papers.",
  },
  {
    id: "biomedical-research",
    name: "Biomedical Research",
    description: "Health, medicine, and life sciences research",
    sourceBundleIds: ["general-research", "biomedical-discovery"],
    defaultToolProfileId: "research-light",
    warnings: [
      "Research findings are not clinical advice.",
      "Always consult qualified healthcare professionals for medical decisions.",
    ],
    systemPromptAddendum:
      "You are a biomedical research assistant. Flag confidence levels. Distinguish peer-reviewed findings from anecdotal reports.",
  },
  {
    id: "trades-and-construction",
    name: "Trades & Construction",
    description:
      "Building trades, construction, and skilled labor research",
    sourceBundleIds: ["general-research", "community-signal"],
    defaultToolProfileId: "research-light",
    warnings: [
      "Building codes vary by jurisdiction. Verify local requirements.",
    ],
    systemPromptAddendum:
      "You are a trades research assistant. Focus on practical, code-compliant solutions with safety considerations.",
  },
  {
    id: "embedded-hardware",
    name: "Embedded & Hardware",
    description: "Embedded systems, electronics, and hardware research",
    sourceBundleIds: ["general-research", "technical-literature"],
    defaultToolProfileId: "research-light",
    warnings: [],
    systemPromptAddendum:
      "You are an embedded systems research assistant. Focus on datasheets, reference designs, and proven solutions.",
  },
];

export function getDomainPack(id: string): DomainPack | undefined {
  return DOMAIN_PACKS.find((p) => p.id === id);
}

export function listDomainPacks(): DomainPack[] {
  return [...DOMAIN_PACKS];
}
