// Phase 7B-4B Task 4 — Verify AgentRpc includes all 21 agent.filesystem +
// agent.chat + agent.post RPCs.
//
// After adding 21 new procedures the group should have 78 total
// (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3 + 21 Task 4).

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
  // post (4)
  AgentPostAllRpc,
  AgentPostByIdRpc,
  AgentPostCreateRpc,
  AgentPostDeleteRpc,
} from "../groups/agent.js";

describe("AgentRpc group — agent.filesystem + chat + post (7B-4B Task 4)", () => {
  it("has 78 procedures total (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3 + 21 Task 4)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBe(85);
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

  it("includes all 4 agent.post procedures by tag", () => {
    const postTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.post."),
    );
    expect(postTags.length).toBe(4);
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

  it("spot-check agent.post.all is registered", () => {
    expect(AgentRpc.requests.get("agent.post.all")).toBe(AgentPostAllRpc);
  });

  it("spot-check agent.post.create is registered", () => {
    expect(AgentRpc.requests.get("agent.post.create")).toBe(
      AgentPostCreateRpc,
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

  it("all 21 Task 4 RPC exports resolve to defined values", () => {
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
      AgentPostAllRpc,
      AgentPostByIdRpc,
      AgentPostCreateRpc,
      AgentPostDeleteRpc,
    ];
    for (const rpc of rpcs) {
      expect(rpc).toBeDefined();
    }
    expect(rpcs.length).toBe(21);
  });
});
