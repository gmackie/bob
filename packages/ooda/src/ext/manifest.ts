export const OodaExtensionManifest = {
  id: "gmacko.ooda",
  name: "OODA Research",
  version: "0.1.0",
  hostVersionRange: ">=0.1.0",
  description:
    "Research workstation with autonomous exploration, wiki synthesis, and knowledge graph",
  slots: [
    {
      surface: "thread.sidePanel" as const,
      entries: [
        {
          id: "ooda-research",
          title: "Research",
          component: "./panels/research-panel",
        },
        {
          id: "ooda-wiki",
          title: "Wiki",
          component: "./panels/wiki-panel",
        },
      ],
    },
    {
      surface: "threads.sidebar.section" as const,
      entries: [
        {
          id: "ooda-explorations",
          title: "Explorations",
          component: "./panels/explorations-section",
        },
      ],
    },
    {
      surface: "thread.header.actions" as const,
      entries: [
        {
          id: "ooda-capture",
          title: "Quick Capture",
          component: "./panels/capture-action",
        },
        {
          id: "ooda-synthesize",
          title: "Write Up",
          component: "./panels/synthesize-action",
        },
      ],
    },
  ],
  capabilities: [
    "read.thread-view",
    "action.open-thread",
    "action.request-workspace-write",
  ] as const,
} as const;
