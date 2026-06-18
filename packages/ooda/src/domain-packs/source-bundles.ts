import type { SourceBundle } from "@gmacko/ooda/capability-registry";

const SOURCE_BUNDLES: SourceBundle[] = [
  {
    id: "general-research",
    name: "General Research",
    description: "General-purpose research sources across diverse topics",
    connectorIds: ["reddit", "hacker-news", "crossref", "semantic-scholar"],
  },
  {
    id: "community-signal",
    name: "Community Signal",
    description: "Community forums and discussion platforms",
    connectorIds: ["reddit", "hacker-news", "stack-exchange"],
  },
  {
    id: "technical-literature",
    name: "Technical Literature",
    description: "Academic and technical publication sources",
    connectorIds: ["crossref", "semantic-scholar", "arxiv"],
  },
  {
    id: "biomedical-discovery",
    name: "Biomedical Discovery",
    description: "Biomedical and life sciences research sources",
    connectorIds: ["pubmed", "crossref", "semantic-scholar"],
  },
];

export function getSourceBundle(id: string): SourceBundle | undefined {
  return SOURCE_BUNDLES.find((b) => b.id === id);
}

export function listSourceBundles(): SourceBundle[] {
  return [...SOURCE_BUNDLES];
}
