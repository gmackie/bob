import { AgentRpc } from "@gmacko/core/contracts/groups/agent";

import type { ClientRuntime } from "./internal/runtime.js";
import {
  makeInvoke,
  makeStreamInvoke,
  type RpcMethod,
} from "./internal/invoke.js";

export interface AgentClient extends Record<string, unknown> {
  readonly createSession: RpcMethod;
  readonly sendTurn: (input?: unknown) => AsyncIterable<unknown>;
  readonly cancelSession: RpcMethod;
  readonly closeSession: RpcMethod;
  readonly getTranscript: RpcMethod;
  readonly listRuns: RpcMethod;
  readonly listAllRuns: RpcMethod;
  readonly run: {
    readonly get: RpcMethod;
    readonly list: RpcMethod;
    readonly listAll: RpcMethod;
    readonly listByWorkItem: RpcMethod;
  };
  readonly capture: {
    readonly listTargets: RpcMethod;
    readonly capture: RpcMethod;
  };
  readonly session: {
    readonly list: RpcMethod;
    readonly get: RpcMethod;
    readonly create: RpcMethod;
    readonly bootstrapForChat: RpcMethod;
    readonly updateTitle: RpcMethod;
    readonly stop: RpcMethod;
    readonly delete: RpcMethod;
    readonly getEvents: RpcMethod;
    readonly getConnections: RpcMethod;
    readonly sendHeadlessInput: RpcMethod;
    readonly updateStatus: RpcMethod;
    readonly claimLease: RpcMethod;
    readonly releaseLease: RpcMethod;
    readonly recordEvent: RpcMethod;
    readonly recordEventBatch: RpcMethod;
    readonly getGatewayWebSocketUrl: RpcMethod;
    readonly reportWorkflowStatus: RpcMethod;
    readonly reportTaskProgress: RpcMethod;
    readonly linkTaskArtifact: RpcMethod;
    readonly markTaskReviewReady: RpcMethod;
    readonly recordVerificationResult: RpcMethod;
    readonly completeTask: RpcMethod;
    readonly requestInput: RpcMethod;
    readonly resolveAwaitingInput: RpcMethod;
    readonly getWorkflowState: RpcMethod;
    readonly createVoiceSession: RpcMethod;
    readonly stopVoiceSession: RpcMethod;
    readonly handleVoiceTranscript: RpcMethod;
  };
  readonly instance: Record<string, RpcMethod>;
  readonly terminal: {
    readonly createAgentSession: RpcMethod;
    readonly createDirectorySession: RpcMethod;
    readonly createSystemSession: RpcMethod;
    readonly listByInstance: RpcMethod;
    readonly close: RpcMethod;
  };
  readonly event: Record<string, RpcMethod>;
  readonly filesystem: {
    readonly list: RpcMethod;
    readonly read: RpcMethod;
    readonly write: RpcMethod;
    readonly delete: RpcMethod;
    readonly mkdir: RpcMethod;
    readonly move: RpcMethod;
    readonly copy: RpcMethod;
    readonly search: RpcMethod;
    readonly gitStatus: RpcMethod;
  };
  readonly chat: Record<string, RpcMethod>;
  readonly persona: {
    readonly create: RpcMethod;
    readonly list: RpcMethod;
    readonly get: RpcMethod;
    readonly update: RpcMethod;
    readonly delete: RpcMethod;
    readonly syncRepo: () => Promise<unknown>;
  };
}

export const makeAgentClient = (runtime: ClientRuntime): AgentClient => {
  const invoke = makeInvoke(runtime, AgentRpc);
  const invokeStream = makeStreamInvoke(runtime, AgentRpc);

  return {
    createSession: (input) => invoke("agent.createSession", input),
    sendTurn: (input) => invokeStream("agent.sendTurn", input),
    cancelSession: (input) => invoke("agent.cancelSession", input),
    closeSession: (input) => invoke("agent.closeSession", input),
    getTranscript: (input) => invoke("agent.getTranscript", input),
    listRuns: (input) => invoke("agent.run.list", input),
    listAllRuns: (input) => invoke("agent.run.listAll", input),
    run: {
      get: (input) => invoke("agent.run.get", input),
      list: (input) => invoke("agent.run.list", input),
      listAll: (input) => invoke("agent.run.listAll", input),
      listByWorkItem: (input) => invoke("agent.run.listByWorkItem", input),
    },
    capture: {
      listTargets: (input) => invoke("agent.capture.listTargets", input),
      capture: (input) => invoke("agent.capture.capture", input),
    },
    session: {
      list: (input) => invoke("agent.session.list", input),
      get: (input) => invoke("agent.session.get", input),
      create: (input) => invoke("agent.session.create", input),
      bootstrapForChat: (input) =>
        invoke("agent.session.bootstrapForChat", input),
      updateTitle: (input) => invoke("agent.session.updateTitle", input),
      stop: (input) => invoke("agent.session.stop", input),
      delete: (input) => invoke("agent.session.delete", input),
      getEvents: (input) => invoke("agent.session.getEvents", input),
      getConnections: (input) =>
        invoke("agent.session.getConnections", input),
      sendHeadlessInput: (input) =>
        invoke("agent.session.sendHeadlessInput", input),
      updateStatus: (input) => invoke("agent.session.updateStatus", input),
      claimLease: (input) => invoke("agent.session.claimLease", input),
      releaseLease: (input) =>
        invoke("agent.session.releaseLease", input),
      recordEvent: (input) => invoke("agent.session.recordEvent", input),
      recordEventBatch: (input) =>
        invoke("agent.session.recordEventBatch", input),
      getGatewayWebSocketUrl: (input) =>
        invoke("agent.session.getGatewayWebSocketUrl", input),
      reportWorkflowStatus: (input) =>
        invoke("agent.session.reportWorkflowStatus", input),
      reportTaskProgress: (input) =>
        invoke("agent.session.reportTaskProgress", input),
      linkTaskArtifact: (input) =>
        invoke("agent.session.linkTaskArtifact", input),
      markTaskReviewReady: (input) =>
        invoke("agent.session.markTaskReviewReady", input),
      recordVerificationResult: (input) =>
        invoke("agent.session.recordVerificationResult", input),
      completeTask: (input) =>
        invoke("agent.session.completeTask", input),
      requestInput: (input) => invoke("agent.session.requestInput", input),
      resolveAwaitingInput: (input) =>
        invoke("agent.session.resolveAwaitingInput", input),
      getWorkflowState: (input) =>
        invoke("agent.session.getWorkflowState", input),
      createVoiceSession: (input) =>
        invoke("agent.session.createVoiceSession", input),
      stopVoiceSession: (input) =>
        invoke("agent.session.stopVoiceSession", input),
      handleVoiceTranscript: (input) =>
        invoke("agent.session.handleVoiceTranscript", input),
    },
    instance: {
      list: (input) => invoke("agent.instance.list", input),
      byId: (input) => invoke("agent.instance.byId", input),
      byRepository: (input) =>
        invoke("agent.instance.byRepository", input),
      byWorktree: (input) => invoke("agent.instance.byWorktree", input),
      start: (input) => invoke("agent.instance.start", input),
      stop: (input) => invoke("agent.instance.stop", input),
      restart: (input) => invoke("agent.instance.restart", input),
      delete: (input) => invoke("agent.instance.delete", input),
      updateStatus: (input) =>
        invoke("agent.instance.updateStatus", input),
    },
    terminal: {
      createAgentSession: (input) =>
        invoke("agent.terminal.createAgentSession", input),
      createDirectorySession: (input) =>
        invoke("agent.terminal.createDirectorySession", input),
      createSystemSession: (input) =>
        invoke("agent.terminal.createSystemSession", input),
      listByInstance: (input) =>
        invoke("agent.terminal.listByInstance", input),
      close: (input) => invoke("agent.terminal.close", input),
    },
    event: {
      list: (input) => invoke("agent.event.list", input),
      create: (input) => invoke("agent.event.create", input),
      recentActivity: (input) =>
        invoke("agent.event.recentActivity", input),
      byWorktree: (input) => invoke("agent.event.byWorktree", input),
      stats: (input) => invoke("agent.event.stats", input),
    },
    filesystem: {
      list: (input) => invoke("agent.filesystem.list", input),
      read: (input) => invoke("agent.filesystem.read", input),
      write: (input) => invoke("agent.filesystem.write", input),
      delete: (input) => invoke("agent.filesystem.delete", input),
      mkdir: (input) => invoke("agent.filesystem.mkdir", input),
      move: (input) => invoke("agent.filesystem.move", input),
      copy: (input) => invoke("agent.filesystem.copy", input),
      search: (input) => invoke("agent.filesystem.search", input),
      gitStatus: (input) => invoke("agent.filesystem.gitStatus", input),
    },
    chat: {
      listConversations: (input) =>
        invoke("agent.chat.listConversations", input),
      getConversation: (input) =>
        invoke("agent.chat.getConversation", input),
      createConversation: (input) =>
        invoke("agent.chat.createConversation", input),
      deleteConversation: (input) =>
        invoke("agent.chat.deleteConversation", input),
      sendMessage: (input) => invoke("agent.chat.sendMessage", input),
      getMessages: (input) => invoke("agent.chat.getMessages", input),
      attachImage: (input) => invoke("agent.chat.attachImage", input),
      getAttachments: (input) =>
        invoke("agent.chat.getAttachments", input),
    },
    persona: {
      create: (input) => invoke("agent.persona.create", input),
      list: (input) => invoke("agent.persona.list", input),
      get: (input) => invoke("agent.persona.get", input),
      update: (input) => invoke("agent.persona.update", input),
      delete: (input) => invoke("agent.persona.delete", input),
      syncRepo: () => invoke("agent.persona.syncRepo"),
    },
  };
};
