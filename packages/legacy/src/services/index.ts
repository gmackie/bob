export {
  GitService,
  DEFAULT_USER_ID as GIT_DEFAULT_USER_ID,
} from "./git-service.js";
export type {
  GitStorageAdapter,
  UserPathsConfig,
  GitServiceConfig,
} from "./git-service.js";
export { InMemoryGitStorage, DefaultUserPaths } from "./git-service.js";

export {
  AgentService,
  DEFAULT_USER_ID as AGENT_DEFAULT_USER_ID,
} from "./agent-service.js";
export type {
  AgentStorageAdapter,
  AgentFactoryInterface,
  AgentServiceConfig,
} from "./agent-service.js";
export { InMemoryAgentStorage } from "./agent-service.js";

export { TerminalService } from "./terminal-service.js";
export type { TerminalSession } from "./terminal-service.js";

export const DEFAULT_USER_ID = "default-user";
