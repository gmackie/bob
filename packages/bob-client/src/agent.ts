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
  readonly run: {
    readonly get: RpcMethod;
    readonly list: RpcMethod;
    readonly listByWorkItem: RpcMethod;
  };
  readonly session: Record<string, RpcMethod>;
  readonly instance: Record<string, RpcMethod>;
  readonly event: Record<string, RpcMethod>;
  readonly chat: Record<string, RpcMethod>;
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
    run: {
      get: (input) => invoke("agent.run.get", input),
      list: (input) => invoke("agent.run.list", input),
      listByWorkItem: (input) => invoke("agent.run.listByWorkItem", input),
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
      getGatewayWebSocketUrl: (input) =>
        invoke("agent.session.getGatewayWebSocketUrl", input),
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
    event: {
      list: (input) => invoke("agent.event.list", input),
      create: (input) => invoke("agent.event.create", input),
      recentActivity: (input) =>
        invoke("agent.event.recentActivity", input),
      byWorktree: (input) => invoke("agent.event.byWorktree", input),
      stats: (input) => invoke("agent.event.stats", input),
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
  };
};
