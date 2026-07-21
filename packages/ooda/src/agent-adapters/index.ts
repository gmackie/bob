export {
  AdapterCapabilitySchema,
  type AdapterCapability,
  type AdapterCommand,
  type AdapterEvent,
  type AdapterProcessHandle,
  type AgentAdapter,
  type ExecuteOptions,
  type SpawnedProcessLike,
  type ToolDescriptorLike,
} from "./types";

export { CodexAdapter } from "./codex-adapter";
export { ClaudeAdapter } from "./claude-adapter";
export { GrokAdapter } from "./grok-adapter";

export { AcpClient, type AcpClientOptions } from "./acp-client";
export {
  mapSessionUpdate,
  runGrokAcpSession,
  handleAgentRequest,
  type SessionUpdate,
} from "./grok-acp";

export {
  createBuddyToolDescriptors,
  registerTools,
  type CreateBuddyToolDescriptorsOptions,
  type ToolDescriptor,
} from "./tool-registry";

export { dispatchBuddyTool } from "./tool-dispatcher";
