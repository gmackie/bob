/**
 * Aggregate layer that maps handler factory outputs to AgentRpc contract
 * names (78 procedures).
 *
 * Imports the nine handler factories (agentRun, capture, session, instance,
 * terminal, event, filesystem, chat, post), instantiates them with a
 * HandlerContext, and wires each factory key to the corresponding contract
 * procedure name expected by AgentRpc.toLayer().
 *
 * Five gmacko-only session-lifecycle RPCs (createSession, sendTurn,
 * cancelSession, closeSession, getTranscript) have no Bob equivalent and
 * are stubbed with BobNotFoundError.
 *
 * Phase 7B-4D-delta Task 1.
 */
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { BobNotFoundError } from "@gmacko/bob/contracts";
import { makeAgentRunRpcHandlers } from "../rpc-handlers/agentRun.js";
import { makeCaptureRpcHandlers } from "../rpc-handlers/capture.js";
import { makeSessionRpcHandlers } from "../rpc-handlers/session.js";
import { makeInstanceRpcHandlers } from "../rpc-handlers/instance.js";
import { makeTerminalRpcHandlers } from "../rpc-handlers/terminal.js";
import { makeEventRpcHandlers } from "../rpc-handlers/event.js";
import { makeFilesystemRpcHandlers } from "../rpc-handlers/filesystem.js";
import { makeChatRpcHandlers } from "../rpc-handlers/chat.js";
import { makePostRpcHandlers } from "../rpc-handlers/post.js";

/**
 * Returns the raw handler mapping object for AgentRpc (78 entries).
 * Can be used standalone with `liftHandlers` in the server, or called
 * by `makeAgentLayer` which wraps the result in `AgentRpc.toLayer()`.
 */
export const makeAgentHandlers = (ctx: HandlerContext) => {
  const ar = makeAgentRunRpcHandlers(ctx);
  const cap = makeCaptureRpcHandlers(ctx);
  const sess = makeSessionRpcHandlers(ctx);
  const inst = makeInstanceRpcHandlers(ctx);
  const term = makeTerminalRpcHandlers(ctx);
  const ev = makeEventRpcHandlers(ctx);
  const fs = makeFilesystemRpcHandlers(ctx);
  const ch = makeChatRpcHandlers(ctx);
  const po = makePostRpcHandlers(ctx);

  return {
    // --- Stubs (5) — gmacko-only session lifecycle, no Bob equivalent ---
    "agent.createSession": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "agent", id: "not-implemented" }),
      ),
    "agent.sendTurn": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "agent", id: "not-implemented" }),
      ),
    "agent.cancelSession": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "agent", id: "not-implemented" }),
      ),
    "agent.closeSession": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "agent", id: "not-implemented" }),
      ),
    "agent.getTranscript": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "agent", id: "not-implemented" }),
      ),

    // --- AgentRun (3) ---
    "agent.run.get": ar["agentRun.get"],
    "agent.run.list": ar["agentRun.list"],
    "agent.run.listByWorkItem": ar["agentRun.listByWorkItem"],

    // --- Capture (2) ---
    "agent.capture.listTargets": cap["capture.listTargets"],
    "agent.capture.capture": cap["capture.capture"],

    // --- Session (28) ---
    "agent.session.list": sess["session.list"],
    "agent.session.get": sess["session.get"],
    "agent.session.create": sess["session.create"],
    "agent.session.bootstrapForChat": sess["session.bootstrapForChat"],
    "agent.session.updateTitle": sess["session.updateTitle"],
    "agent.session.stop": sess["session.stop"],
    "agent.session.delete": sess["session.delete"],
    "agent.session.getEvents": sess["session.getEvents"],
    "agent.session.getConnections": sess["session.getConnections"],
    "agent.session.sendHeadlessInput": sess["session.sendHeadlessInput"],
    "agent.session.updateStatus": sess["session.updateStatus"],
    "agent.session.claimLease": sess["session.claimLease"],
    "agent.session.releaseLease": sess["session.releaseLease"],
    "agent.session.recordEvent": sess["session.recordEvent"],
    "agent.session.recordEventBatch": sess["session.recordEventBatch"],
    "agent.session.getGatewayWebSocketUrl":
      sess["session.getGatewayWebSocketUrl"],
    "agent.session.reportWorkflowStatus":
      sess["session.reportWorkflowStatus"],
    "agent.session.reportTaskProgress": sess["session.reportTaskProgress"],
    "agent.session.linkTaskArtifact": sess["session.linkTaskArtifact"],
    "agent.session.markTaskReviewReady": sess["session.markTaskReviewReady"],
    "agent.session.recordVerificationResult":
      sess["session.recordVerificationResult"],
    "agent.session.completeTask": sess["session.completeTask"],
    "agent.session.requestInput": sess["session.requestInput"],
    "agent.session.resolveAwaitingInput":
      sess["session.resolveAwaitingInput"],
    "agent.session.getWorkflowState": sess["session.getWorkflowState"],
    "agent.session.createVoiceSession": sess["session.createVoiceSession"],
    "agent.session.stopVoiceSession": sess["session.stopVoiceSession"],
    "agent.session.handleVoiceTranscript":
      sess["session.handleVoiceTranscript"],

    // --- Instance (9) ---
    "agent.instance.list": inst["instance.list"],
    "agent.instance.byId": inst["instance.byId"],
    "agent.instance.byRepository": inst["instance.byRepository"],
    "agent.instance.byWorktree": inst["instance.byWorktree"],
    "agent.instance.start": inst["instance.start"],
    "agent.instance.stop": inst["instance.stop"],
    "agent.instance.restart": inst["instance.restart"],
    "agent.instance.delete": inst["instance.delete"],
    "agent.instance.updateStatus": inst["instance.updateStatus"],

    // --- Terminal (5) ---
    "agent.terminal.createAgentSession":
      term["terminal.createAgentSession"],
    "agent.terminal.createDirectorySession":
      term["terminal.createDirectorySession"],
    "agent.terminal.createSystemSession":
      term["terminal.createSystemSession"],
    "agent.terminal.listByInstance": term["terminal.listByInstance"],
    "agent.terminal.close": term["terminal.close"],

    // --- Event (5) ---
    "agent.event.list": ev["event.list"],
    "agent.event.create": ev["event.create"],
    "agent.event.recentActivity": ev["event.recentActivity"],
    "agent.event.byWorktree": ev["event.byWorktree"],
    "agent.event.stats": ev["event.stats"],

    // --- Filesystem (9) ---
    "agent.filesystem.list": fs["filesystem.list"],
    "agent.filesystem.read": fs["filesystem.read"],
    "agent.filesystem.write": fs["filesystem.write"],
    "agent.filesystem.delete": fs["filesystem.delete"],
    "agent.filesystem.mkdir": fs["filesystem.mkdir"],
    "agent.filesystem.move": fs["filesystem.move"],
    "agent.filesystem.copy": fs["filesystem.copy"],
    "agent.filesystem.search": fs["filesystem.search"],
    "agent.filesystem.gitStatus": fs["filesystem.gitStatus"],

    // --- Chat (8) ---
    "agent.chat.listConversations": ch["chat.listConversations"],
    "agent.chat.getConversation": ch["chat.getConversation"],
    "agent.chat.createConversation": ch["chat.createConversation"],
    "agent.chat.deleteConversation": ch["chat.deleteConversation"],
    "agent.chat.sendMessage": ch["chat.sendMessage"],
    "agent.chat.getMessages": ch["chat.getMessages"],
    "agent.chat.attachImage": ch["chat.attachImage"],
    "agent.chat.getAttachments": ch["chat.getAttachments"],

    // --- Post (4) ---
    "agent.post.all": po["post.all"],
    "agent.post.byId": po["post.byId"],
    "agent.post.create": po["post.create"],
    "agent.post.delete": po["post.delete"],
  } as const;
};

export const makeAgentLayer = (ctx: HandlerContext) =>
  AgentRpc.toLayer(makeAgentHandlers(ctx));
