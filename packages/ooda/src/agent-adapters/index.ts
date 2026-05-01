export {
  AdapterCapabilitySchema,
  type AdapterCapability,
  type AdapterCommand,
  type AdapterEvent,
  type AgentAdapter,
  type ToolDescriptorLike,
} from "./types";

export { CodexAdapter } from "./codex-adapter";
export { ClaudeAdapter } from "./claude-adapter";

export {
  createBuddyToolDescriptors,
  registerTools,
  type CreateBuddyToolDescriptorsOptions,
  type ToolDescriptor,
} from "./tool-registry";
