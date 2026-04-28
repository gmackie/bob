import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Thread, CreateThreadInput, UpdateThreadStatusInput } from "./schemas/thread";
import { Branch, CreateBranchInput, SetActiveBranchInput } from "./schemas/branch";
import { Message, CreateMessageInput, ChatInput } from "./schemas/message";
import { WikiArticle, SynthesizeInput, SynthesizeResult } from "./schemas/wiki";
import { StartExplorationInput, RespondToCheckInInput, ExplorationSummary } from "./schemas/exploration";
import { ThreadNotFoundError, BranchNotFoundError, AgentError, WikiError, ExplorationError } from "./errors";

export const METHODS = {
  // Threads
  threadsList: "threads.list",
  threadsById: "threads.byId",
  threadsCreate: "threads.create",
  threadsUpdateStatus: "threads.updateStatus",
  // Branches
  branchesListByThread: "branches.listByThread",
  branchesCreate: "branches.create",
  branchesSetActive: "branches.setActive",
  // Messages
  messagesListByBranch: "messages.listByBranch",
  messagesCreate: "messages.create",
  // Agent
  agentChat: "agent.chat",
  // Wiki
  wikiSynthesize: "wiki.synthesize",
  wikiList: "wiki.list",
  wikiOrphans: "wiki.orphans",
  // Exploration
  explorationStart: "exploration.start",
  explorationRespond: "exploration.respond",
  explorationStatus: "exploration.status",
  explorationList: "exploration.list",
} as const;

// --- Thread RPCs ---
export const ThreadsListRpc = Rpc.make(METHODS.threadsList, {
  payload: Schema.Struct({}),
  success: Schema.Array(Thread),
});

export const ThreadsByIdRpc = Rpc.make(METHODS.threadsById, {
  payload: Schema.Struct({ id: Schema.String.check(Schema.isUUID()) }),
  success: Thread,
  error: ThreadNotFoundError,
});

export const ThreadsCreateRpc = Rpc.make(METHODS.threadsCreate, {
  payload: CreateThreadInput,
  success: Thread,
});

export const ThreadsUpdateStatusRpc = Rpc.make(METHODS.threadsUpdateStatus, {
  payload: UpdateThreadStatusInput,
  success: Thread,
  error: ThreadNotFoundError,
});

// --- Branch RPCs ---
export const BranchesListByThreadRpc = Rpc.make(METHODS.branchesListByThread, {
  payload: Schema.Struct({ threadId: Schema.String.check(Schema.isUUID()) }),
  success: Schema.Array(Branch),
});

export const BranchesCreateRpc = Rpc.make(METHODS.branchesCreate, {
  payload: CreateBranchInput,
  success: Branch,
});

export const BranchesSetActiveRpc = Rpc.make(METHODS.branchesSetActive, {
  payload: SetActiveBranchInput,
  success: Schema.Void,
});

// --- Message RPCs ---
export const MessagesListByBranchRpc = Rpc.make(METHODS.messagesListByBranch, {
  payload: Schema.Struct({ threadId: Schema.String.check(Schema.isUUID()), branchId: Schema.String.check(Schema.isUUID()) }),
  success: Schema.Array(Message),
});

export const MessagesCreateRpc = Rpc.make(METHODS.messagesCreate, {
  payload: CreateMessageInput,
  success: Message,
});

// --- Agent RPCs ---
export const AgentChatRpc = Rpc.make(METHODS.agentChat, {
  payload: ChatInput,
  success: Message,
  error: AgentError,
});

// --- Wiki RPCs ---
export const WikiSynthesizeRpc = Rpc.make(METHODS.wikiSynthesize, {
  payload: SynthesizeInput,
  success: SynthesizeResult,
  error: WikiError,
});

export const WikiListRpc = Rpc.make(METHODS.wikiList, {
  payload: Schema.Struct({}),
  success: Schema.Array(WikiArticle),
});

export const WikiOrphansRpc = Rpc.make(METHODS.wikiOrphans, {
  payload: Schema.Struct({}),
  success: Schema.Array(Schema.String),
});

// --- Exploration RPCs ---
export const ExplorationStartRpc = Rpc.make(METHODS.explorationStart, {
  payload: StartExplorationInput,
  success: ExplorationSummary,
  error: ExplorationError,
});

export const ExplorationRespondRpc = Rpc.make(METHODS.explorationRespond, {
  payload: RespondToCheckInInput,
  success: ExplorationSummary,
  error: ExplorationError,
});

export const ExplorationStatusRpc = Rpc.make(METHODS.explorationStatus, {
  payload: Schema.Struct({ explorationId: Schema.String.check(Schema.isUUID()) }),
  success: ExplorationSummary,
  error: ExplorationError,
});

export const ExplorationListRpc = Rpc.make(METHODS.explorationList, {
  payload: Schema.Struct({}),
  success: Schema.Array(ExplorationSummary),
});

// --- RPC Group ---
export const GmackoRpcGroup = RpcGroup.make(
  ThreadsListRpc,
  ThreadsByIdRpc,
  ThreadsCreateRpc,
  ThreadsUpdateStatusRpc,
  BranchesListByThreadRpc,
  BranchesCreateRpc,
  BranchesSetActiveRpc,
  MessagesListByBranchRpc,
  MessagesCreateRpc,
  AgentChatRpc,
  WikiSynthesizeRpc,
  WikiListRpc,
  WikiOrphansRpc,
  ExplorationStartRpc,
  ExplorationRespondRpc,
  ExplorationStatusRpc,
  ExplorationListRpc,
);
