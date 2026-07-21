// Phase 7B-4B Task 4 — Verify AgentRpc includes all agent.filesystem +
// agent.chat RPCs.
//
// The group should have 81 total procedures
// (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3 + 17 filesystem/chat).

import { describe, expect, it } from "vitest";

import {
  AgentRpc,
  // filesystem (9)
  AgentFilesystemListRpc,
  AgentFilesystemReadRpc,
  AgentFilesystemWriteRpc,
  AgentFilesystemDeleteRpc,
  AgentFilesystemMkdirRpc,
  AgentFilesystemMoveRpc,
  AgentFilesystemCopyRpc,
  AgentFilesystemSearchRpc,
  AgentFilesystemGitStatusRpc,
  // chat (8)
  AgentChatListConversationsRpc,
  AgentChatGetConversationRpc,
  AgentChatCreateConversationRpc,
  AgentChatDeleteConversationRpc,
  AgentChatSendMessageRpc,
  AgentChatGetMessagesRpc,
  AgentChatAttachImageRpc,
  AgentChatGetAttachmentsRpc,
} from "../groups/agent.js";

describe("AgentRpc group — agent.filesystem + chat (7B-4B Task 4)", () => {
  it("has 81 procedures total (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3 + 17 filesystem/chat)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBe(81);
  });

  it("includes all 9 agent.filesystem procedures by tag", () => {
    const fsTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.filesystem."),
    );
    expect(fsTags.length).toBe(9);
  });

  it("includes all 8 agent.chat procedures by tag", () => {
    const chatTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.chat."),
    );
    expect(chatTags.length).toBe(8);
  });

  it("no longer registers any agent.post procedures", () => {
    const postTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.post."),
    );
    expect(postTags.length).toBe(0);
  });

  it("spot-check agent.filesystem.list is registered", () => {
    expect(AgentRpc.requests.get("agent.filesystem.list")).toBe(
      AgentFilesystemListRpc,
    );
  });

  it("spot-check agent.filesystem.gitStatus is registered", () => {
    expect(AgentRpc.requests.get("agent.filesystem.gitStatus")).toBe(
      AgentFilesystemGitStatusRpc,
    );
  });

  it("spot-check agent.chat.listConversations is registered", () => {
    expect(AgentRpc.requests.get("agent.chat.listConversations")).toBe(
      AgentChatListConversationsRpc,
    );
  });

  it("spot-check agent.chat.attachImage is registered", () => {
    expect(AgentRpc.requests.get("agent.chat.attachImage")).toBe(
      AgentChatAttachImageRpc,
    );
  });

  it("preserves all previous procedures (original 5 + Tasks 1-3)", () => {
    // Original 5
    expect(AgentRpc.requests.has("agent.createSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.sendTurn")).toBe(true);
    expect(AgentRpc.requests.has("agent.cancelSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.closeSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.getTranscript")).toBe(true);
    // Task 1
    expect(AgentRpc.requests.has("agent.run.get")).toBe(true);
    expect(AgentRpc.requests.has("agent.capture.capture")).toBe(true);
    // Task 2 (spot-check)
    expect(AgentRpc.requests.has("agent.session.list")).toBe(true);
    expect(AgentRpc.requests.has("agent.session.claimLease")).toBe(true);
    // Task 3 (spot-check)
    expect(AgentRpc.requests.has("agent.instance.list")).toBe(true);
    expect(AgentRpc.requests.has("agent.terminal.close")).toBe(true);
    expect(AgentRpc.requests.has("agent.event.stats")).toBe(true);
  });

  it("all 17 filesystem/chat RPC exports resolve to defined values", () => {
    const rpcs = [
      AgentFilesystemListRpc,
      AgentFilesystemReadRpc,
      AgentFilesystemWriteRpc,
      AgentFilesystemDeleteRpc,
      AgentFilesystemMkdirRpc,
      AgentFilesystemMoveRpc,
      AgentFilesystemCopyRpc,
      AgentFilesystemSearchRpc,
      AgentFilesystemGitStatusRpc,
      AgentChatListConversationsRpc,
      AgentChatGetConversationRpc,
      AgentChatCreateConversationRpc,
      AgentChatDeleteConversationRpc,
      AgentChatSendMessageRpc,
      AgentChatGetMessagesRpc,
      AgentChatAttachImageRpc,
      AgentChatGetAttachmentsRpc,
    ];
    for (const rpc of rpcs) {
      expect(rpc).toBeDefined();
    }
    expect(rpcs.length).toBe(17);
  });
});
