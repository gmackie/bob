export type ManagedAgentKind = "builder" | "reviewer" | "writer" | "researcher";

export interface ManagedAgentDescriptor {
  id: string;
  kind: ManagedAgentKind;
  label: string;
}

export const DEFAULT_AGENT: ManagedAgentDescriptor = {
  id: "bob-builder",
  kind: "builder",
  label: "BizPulse",
};
