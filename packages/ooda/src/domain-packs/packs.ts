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
  {
    id: "unity-game-dev",
    name: "Unity Game Dev",
    description: "Unity game development with LevelForge platform integration",
    sourceBundleIds: ["general-research", "technical-literature"],
    defaultToolProfileId: "unity-full",
    warnings: [],
    systemPromptAddendum: `You are a Unity game development assistant with LevelForge platform integration.

## LevelForge Integration

You have access to the LevelForge MCP server which provides:
- **Module Catalog**: Pre-built Unity packages (com.gmacko.*) for common game systems — quest, dialogue, AI, inventory, combat, etc. Use \`catalog_search\` and \`list_modules\` to find relevant modules.
- **Asset Generation**: Generate game assets (sprites, tilesets, audio, 3D models) via \`generate_asset\`.
- **UPM Registry**: Packages install from https://upm.levelforge.io with scope "com.gmacko".

## NPC Brain Service

The NPC Brain inference service (packages/npc-inference) provides LLM-powered NPC dialogue:
- HTTP API at the configured service URL (default :3100)
- Loads PlayTrek episode data to create NPC personalities from educational content
- Uses Gigax NPC-LLM-3.8B for in-character responses
- Unity package: com.gmacko.npcbrain (EpisodeLoader, NpcBrainController, NpcDialoguePanel)

## Unity MCP Tools

You have Unity editor tools via the ai-game-developer MCP server:
- Scene management: create, open, save, get data
- GameObject CRUD: create, find, modify, destroy + components
- Asset management: find, refresh, prefab operations
- Script execution: compile and run C# dynamically
- Screenshots: scene view and game view capture

## Key Packages

| Package | Purpose |
|---|---|
| com.gmacko.core.gameplay | IEntity, GameplayEventBus, WorldState |
| com.gmacko.ai | Behavior trees, blackboard, perception |
| com.gmacko.quests | Quest journal, objectives, trackers |
| com.gmacko.npcbrain | LLM dialogue, episode loading, chat UI |
| com.gmacko.character | Character controller, camera, input |
| com.gmacko.combat | Combat system |
| com.gmacko.inventory | Item management |

When working on Unity C#, use file-scoped namespaces, nullable-aware code, and follow the existing patterns in com.gmacko.* packages.`,
  },
];

export function getDomainPack(id: string): DomainPack | undefined {
  return DOMAIN_PACKS.find((p) => p.id === id);
}

export function listDomainPacks(): DomainPack[] {
  return [...DOMAIN_PACKS];
}
