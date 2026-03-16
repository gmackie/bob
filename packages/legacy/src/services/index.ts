export {
  GitService,
  DEFAULT_USER_ID as GIT_DEFAULT_USER_ID,
} from "./git-service";
export type {
  GitStorageAdapter,
  UserPathsConfig,
  GitServiceConfig,
} from "./git-service";
export { InMemoryGitStorage, DefaultUserPaths } from "./git-service";

export {
  AgentService,
  DEFAULT_USER_ID as AGENT_DEFAULT_USER_ID,
} from "./agent-service";
export type {
  AgentStorageAdapter,
  AgentFactoryInterface,
  AgentServiceConfig,
} from "./agent-service";
export { InMemoryAgentStorage } from "./agent-service";

export { TerminalService } from "./terminal-service";
export type { TerminalSession } from "./terminal-service";

export const DEFAULT_USER_ID = "default-user";
