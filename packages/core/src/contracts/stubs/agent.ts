// Deterministic in-memory stub handlers for the AgentRpc group.
//
// OODA (and any other consumer) mounts this layer during dev so they can code
// against real Schema types while gmacko back-fills the runtime services in
// 6J. Returns a fixed conversation id, a fixed "user said X" stub stream, and
// a fixed 2-message transcript.
//
// Shape notes:
//   - `RpcGroup.toLayer(handlers)` builds the server-side Layer consumed by
//     `RpcServer.layerHttp`. Streaming handlers may return `Stream<A, E, R>`
//     directly OR `Effect<Queue.Dequeue<A, E | Cause.Done>, EX, R>` per
//     `effect/unstable/rpc/Rpc.d.ts:277`. This stub returns `Stream` directly
//     (simplest shape — no queue bookkeeping needed).
//   - `RpcGroup.of(handlers)` returns the raw handler record typed against
//     the group. Exposing both the Layer (for server mounting) and the raw
//     handlers (for unit tests that invoke a single handler without the
//     full RPC machinery) keeps tests trivial.
//   - `Stream.fromIterable` + `Stream.fail` are the two primitives needed
//     for deterministic streaming output. Both exist in Effect 4.0.0-beta.43
//     (`Stream.d.ts:698,858`).

import { DateTime, Effect, Stream } from "effect";

import { AgentSessionNotFoundError } from "@gmacko/core/agent/errors";
import { NotFoundError } from "../../rpc/errors.js";

import { AgentRpc } from "../groups/agent.js";

import { SessionLeaseConflictError } from "../schemas/agent-session.js";
import {
  PersonaNotFoundError,
  type AgentPersonaWire,
} from "../schemas/agent-persona.js";

const STUB_CONVERSATION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const STUB_USER_ID = "user_stub_abc";
const STUB_MODEL = "claude-sonnet-4";
const STUB_RUN_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr";
const STUB_WORKSPACE_ID = "wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww";
const STUB_SESSION_ID = "ssssssss-ssss-ssss-ssss-ssssssssssss";
const STUB_GATEWAY_ID = "gw-stub-001";
const STUB_INSTANCE_ID = "iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii";
const STUB_REPO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUB_WORKTREE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STUB_DATE = new Date("2026-04-21T00:00:00.000Z");

/** Minimal stub instance record reused across instance handlers. */
const STUB_INSTANCE = {
  id: STUB_INSTANCE_ID,
  userId: STUB_USER_ID,
  repositoryId: STUB_REPO_ID,
  worktreeId: STUB_WORKTREE_ID,
  agentType: "claude",
  status: "running" as const,
  pid: 12345,
  port: null,
  errorMessage: null,
  lastActivity: null,
  createdAt: "2026-04-21T00:00:00.000Z",
  updatedAt: null,
};

/** Minimal stub event log record reused across event handlers. */
const STUB_EVENT = {
  id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  userId: STUB_USER_ID,
  worktreeId: STUB_WORKTREE_ID,
  repositoryId: STUB_REPO_ID,
  eventType: "instance.started",
  payload: {},
  createdAt: "2026-04-21T00:00:00.000Z",
};

/** Minimal stub session record reused across session handlers. */
const STUB_SESSION = {
  id: STUB_SESSION_ID,
  title: "Stub session",
  repositoryId: null,
  worktreeId: null,
  workingDirectory: "/tmp/stub",
  agentType: "opencode",
  status: "running" as const,
  nextSeq: 1,
  lastActivityAt: null,
  lastError: null,
  workItemId: null,
  workItemIdentifierSnapshot: null,
  planningTaskId: null,
  createdAt: STUB_DATE,
  updatedAt: STUB_DATE,
};

/** Minimal stub persona record reused across persona handlers. */
const STUB_PERSONA = {
  id: "persona-stub-1",
  tenantId: STUB_TENANT_ID,
  name: "Stub Persona",
  slug: "stub-persona",
  description: null,
  adapterId: "claude",
  model: null,
  systemPrompt: null,
  allowedTools: null,
  autonomyLevel: null,
  budgetLimitCents: null,
  source: "ui" as const,
  active: true,
  metadata: {},
  createdAt: STUB_DATE,
  updatedAt: STUB_DATE,
} satisfies AgentPersonaWire;

const handlers = AgentRpc.of({
  "agent.createSession": (_payload) =>
    Effect.succeed({
      conversationId: STUB_CONVERSATION_ID,
      status: "pending" as const,
    }),

  "agent.sendTurn": ({ conversationId, prompt }) => {
    if (conversationId !== STUB_CONVERSATION_ID) {
      return Stream.fail(
        new AgentSessionNotFoundError({
          conversationId,
          tenantId: STUB_TENANT_ID,
        }),
      );
    }
    return Stream.fromIterable([
      {
        type: "session_init" as const,
        externalSessionId: "stub-ext-session",
        model: STUB_MODEL,
      },
      {
        type: "text_delta" as const,
        text: `you said: ${prompt}`,
      },
      {
        type: "turn_end" as const,
        stopReason: "end_turn",
      },
    ]);
  },

  "agent.cancelSession": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.void
      : Effect.fail(
          new AgentSessionNotFoundError({
            conversationId,
            tenantId: STUB_TENANT_ID,
          }),
        ),

  "agent.closeSession": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.void
      : Effect.fail(
          new AgentSessionNotFoundError({
            conversationId,
            tenantId: STUB_TENANT_ID,
          }),
        ),

  "agent.getTranscript": ({ conversationId }) => {
    if (conversationId !== STUB_CONVERSATION_ID) {
      return Effect.fail(
        new AgentSessionNotFoundError({
          conversationId,
          tenantId: STUB_TENANT_ID,
        }),
      );
    }
    return Effect.succeed({
      conversation: {
        id: STUB_CONVERSATION_ID,
        tenantId: STUB_TENANT_ID,
        userId: STUB_USER_ID,
        title: null,
        adapterId: "claude-code",
        status: "completed" as const,
        metadata: {},
        createdAt: new Date("2026-04-21T00:00:00.000Z"),
        updatedAt: new Date("2026-04-21T00:00:10.000Z"),
      },
      messages: [
        {
          id: "msg-1",
          conversationId: STUB_CONVERSATION_ID,
          seq: 1,
          role: "user" as const,
          content: "hello",
          metadata: {},
          createdAt: new Date("2026-04-21T00:00:01.000Z"),
        },
        {
          id: "msg-2",
          conversationId: STUB_CONVERSATION_ID,
          seq: 2,
          role: "assistant" as const,
          content: "hi there",
          metadata: {},
          createdAt: new Date("2026-04-21T00:00:09.000Z"),
        },
      ],
    });
  },

  // --- 7B-4B Task 1: agent.run + agent.capture stubs ----------------------

  "agent.run.get": ({ runId }) => {
    if (runId !== STUB_RUN_ID) {
      return Effect.fail(new NotFoundError({ entity: "AgentRun", id: runId }));
    }
    return Effect.succeed({
      id: STUB_RUN_ID,
      workspaceId: STUB_WORKSPACE_ID,
      sessionId: null,
      workItemId: null,
      status: "completed" as const,
      startedAt: DateTime.makeUnsafe("2026-04-21T00:00:00.000Z"),
      completedAt: DateTime.makeUnsafe("2026-04-21T00:00:10.000Z"),
      createdAt: DateTime.makeUnsafe("2026-04-21T00:00:00.000Z"),
    });
  },

  "agent.run.list": (_payload) =>
    Effect.succeed([]),

  "agent.run.listAll": (_payload) =>
    Effect.succeed([]),

  "agent.run.listByWorkItem": ({ workItemId }) => {
    if (workItemId !== "stub-work-item") {
      return Effect.fail(
        new NotFoundError({ entity: "WorkItem", id: workItemId }),
      );
    }
    return Effect.succeed([]);
  },

  "agent.capture.listTargets": () =>
    Effect.succeed([
      {
        id: "browser",
        name: "Browser",
        type: "browser" as const,
        description: "Capture any URL",
        connected: true,
      },
    ]),

  "agent.capture.capture": (_payload) =>
    Effect.succeed({
      url: "/uploads/captures/stub.png",
      filename: "stub.png",
      width: 1280,
      height: 720,
      capturedAt: "2026-04-21T00:00:00.000Z",
    }),

  // --- 7B-4B Task 2: agent.session stubs -----------------------------------

  "agent.session.list": (_payload) =>
    Effect.succeed({
      items: [STUB_SESSION],
      nextCursor: undefined,
    }),

  "agent.session.get": ({ id }) =>
    id === STUB_SESSION_ID
      ? Effect.succeed(STUB_SESSION)
      : Effect.fail(new NotFoundError({ entity: "Session", id })),

  "agent.session.create": (_payload) =>
    Effect.succeed({
      ...STUB_SESSION,
      status: "provisioning" as const,
    }),

  "agent.session.bootstrapForChat": (_payload) =>
    Effect.succeed({
      session: { ...STUB_SESSION, status: "provisioning" as const },
      gateway: { url: "ws://localhost:3002/sessions", shouldStartOnConnect: true },
    }),

  "agent.session.updateTitle": ({ id, title }) =>
    id === STUB_SESSION_ID
      ? Effect.succeed({ ...STUB_SESSION, title })
      : Effect.fail(new NotFoundError({ entity: "Session", id })),

  "agent.session.stop": ({ id }) =>
    id === STUB_SESSION_ID
      ? Effect.succeed({ ...STUB_SESSION, status: "stopped" as const })
      : Effect.fail(new NotFoundError({ entity: "Session", id })),

  "agent.session.delete": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.getEvents": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({ events: [], latestSeq: 0 })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.getConnections": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed([])
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.sendHeadlessInput": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({ sessionId, seq: { input: 0, assistant: 1 } })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.updateStatus": ({ id }) =>
    id === STUB_SESSION_ID
      ? Effect.succeed(STUB_SESSION)
      : Effect.fail(new NotFoundError({ entity: "Session", id })),

  "agent.session.claimLease": ({ sessionId, gatewayId }) => {
    if (sessionId !== STUB_SESSION_ID) {
      return Effect.fail(
        new NotFoundError({ entity: "Session", id: sessionId }),
      );
    }
    if (gatewayId !== STUB_GATEWAY_ID) {
      return Effect.fail(
        new SessionLeaseConflictError({
          sessionId,
          claimedByGatewayId: STUB_GATEWAY_ID,
        }),
      );
    }
    return Effect.succeed(STUB_SESSION);
  },

  "agent.session.releaseLease": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed(STUB_SESSION)
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.recordEvent": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({
          id: "evt-stub-1",
          sessionId,
          seq: 1,
          direction: "client" as const,
          eventType: "input",
          payload: {},
          createdAt: STUB_DATE,
        })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.recordEventBatch": ({ sessionId, events }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({ count: events.length })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.getGatewayWebSocketUrl": () =>
    Effect.succeed({
      url: "ws://localhost:3002/sessions",
      userId: STUB_USER_ID,
    }),

  "agent.session.reportWorkflowStatus": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.reportTaskProgress": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.linkTaskArtifact": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.markTaskReviewReady": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.recordVerificationResult": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.completeTask": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.requestInput": (_payload) =>
    Effect.succeed({ promptId: "prompt-stub-1", status: "pending" }),

  "agent.session.resolveAwaitingInput": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.session.getWorkflowState": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({
          sessionId,
          status: "implementing" as const,
          message: "Working on task",
          phase: null,
          progress: null,
          updatedAt: STUB_DATE,
        })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.createVoiceSession": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({
          voiceSessionId: "voice-stub-1",
          url: "wss://voice.stub/session",
        })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.stopVoiceSession": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({ success: true })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  "agent.session.handleVoiceTranscript": ({ sessionId }) =>
    sessionId === STUB_SESSION_ID
      ? Effect.succeed({ assistantText: "Stub voice response" })
      : Effect.fail(new NotFoundError({ entity: "Session", id: sessionId })),

  // --- 7B-4B Task 3: agent.instance stubs ---------------------------------

  "agent.instance.list": () =>
    Effect.succeed([STUB_INSTANCE]),

  "agent.instance.byId": ({ id }) =>
    id === STUB_INSTANCE_ID
      ? Effect.succeed(STUB_INSTANCE)
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id })),

  "agent.instance.byRepository": (_payload) =>
    Effect.succeed([STUB_INSTANCE]),

  "agent.instance.byWorktree": (_payload) =>
    Effect.succeed([STUB_INSTANCE]),

  "agent.instance.start": (_payload) =>
    Effect.succeed({
      ...STUB_INSTANCE,
      status: "starting" as const,
      pid: null,
    }),

  "agent.instance.stop": ({ id }) =>
    id === STUB_INSTANCE_ID
      ? Effect.succeed({ ...STUB_INSTANCE, status: "stopped" as const, pid: null })
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id })),

  "agent.instance.restart": ({ id }) =>
    id === STUB_INSTANCE_ID
      ? Effect.succeed({ ...STUB_INSTANCE, status: "starting" as const, pid: null })
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id })),

  "agent.instance.delete": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.instance.updateStatus": ({ id }) =>
    id === STUB_INSTANCE_ID
      ? Effect.succeed(STUB_INSTANCE)
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id })),

  // --- 7B-4B Task 3: agent.terminal stubs ---------------------------------

  "agent.terminal.createAgentSession": ({ instanceId }) =>
    instanceId === STUB_INSTANCE_ID
      ? Effect.succeed({
          sessionId: "ts-stub-001",
          instanceId,
          agentType: "claude",
        })
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id: instanceId })),

  "agent.terminal.createDirectorySession": ({ instanceId }) =>
    instanceId === STUB_INSTANCE_ID
      ? Effect.succeed({
          sessionId: "ts-stub-002",
          instanceId,
          path: "/tmp/stub-worktree",
        })
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id: instanceId })),

  "agent.terminal.createSystemSession": (_payload) =>
    Effect.succeed({
      sessionId: "ts-stub-003",
      cwd: "/tmp",
      initialCommand: undefined,
    }),

  "agent.terminal.listByInstance": ({ instanceId }) =>
    instanceId === STUB_INSTANCE_ID
      ? Effect.succeed([])
      : Effect.fail(new NotFoundError({ entity: "AgentInstance", id: instanceId })),

  "agent.terminal.close": (_payload) =>
    Effect.succeed({ success: true }),

  // --- 7B-4B Task 3: agent.event stubs ------------------------------------

  "agent.event.list": (_payload) =>
    Effect.succeed([STUB_EVENT]),

  "agent.event.create": (_payload) =>
    Effect.succeed(STUB_EVENT),

  "agent.event.recentActivity": (_payload) =>
    Effect.succeed([STUB_EVENT]),

  "agent.event.byWorktree": (_payload) =>
    Effect.succeed([STUB_EVENT]),

  "agent.event.stats": (_payload) =>
    Effect.succeed({ total: 1, byType: { "instance.started": 1 } }),

  // --- 7B-4B Task 4: agent.filesystem stubs --------------------------------

  "agent.filesystem.list": (_payload) =>
    Effect.succeed([
      {
        name: "README.md",
        path: "/tmp/stub/README.md",
        isDirectory: false,
        size: 1024,
        modifiedAt: "2026-04-21T00:00:00.000Z",
      },
    ]),

  "agent.filesystem.read": (_payload) =>
    Effect.succeed({ content: "# Stub file content\n" }),

  "agent.filesystem.write": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.filesystem.delete": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.filesystem.mkdir": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.filesystem.move": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.filesystem.copy": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.filesystem.search": (_payload) =>
    Effect.succeed([]),

  "agent.filesystem.gitStatus": (_payload) =>
    Effect.succeed([
      { path: "README.md", status: "modified" },
    ]),

  // --- 7B-4B Task 4: agent.chat stubs -------------------------------------

  "agent.chat.listConversations": (_payload) =>
    Effect.succeed([
      {
        id: STUB_CONVERSATION_ID,
        tenantId: STUB_TENANT_ID,
        userId: STUB_USER_ID,
        title: null,
        adapterId: "claude-code",
        status: "active" as const,
        metadata: {},
        createdAt: STUB_DATE,
        updatedAt: STUB_DATE,
      },
    ]),

  "agent.chat.getConversation": ({ id }) =>
    id === STUB_CONVERSATION_ID
      ? Effect.succeed({
          conversation: {
            id: STUB_CONVERSATION_ID,
            tenantId: STUB_TENANT_ID,
            userId: STUB_USER_ID,
            title: null,
            adapterId: "claude-code",
            status: "active" as const,
            metadata: {},
            createdAt: STUB_DATE,
            updatedAt: STUB_DATE,
          },
          messages: [],
        })
      : Effect.fail(new NotFoundError({ entity: "Conversation", id })),

  "agent.chat.createConversation": (_payload) =>
    Effect.succeed({
      id: STUB_CONVERSATION_ID,
      tenantId: STUB_TENANT_ID,
      userId: STUB_USER_ID,
      title: null,
      adapterId: "claude-code",
      status: "pending" as const,
      metadata: {},
      createdAt: STUB_DATE,
      updatedAt: STUB_DATE,
    }),

  "agent.chat.deleteConversation": (_payload) =>
    Effect.succeed({ success: true }),

  "agent.chat.sendMessage": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.succeed({
          id: "msg-stub-1",
          conversationId,
          seq: 1,
          role: "user" as const,
          content: "stub message",
          metadata: {},
          createdAt: STUB_DATE,
        })
      : Effect.fail(
          new NotFoundError({ entity: "Conversation", id: conversationId }),
        ),

  "agent.chat.getMessages": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.succeed([])
      : Effect.fail(
          new NotFoundError({ entity: "Conversation", id: conversationId }),
        ),

  "agent.chat.attachImage": ({ messageId }) =>
    messageId === "msg-stub-1"
      ? Effect.succeed({
          id: "att-stub-1",
          messageId,
          type: "image",
          url: "/uploads/stub.png",
          filename: null,
          mimeType: null,
          width: null,
          height: null,
          sizeBytes: null,
          createdAt: STUB_DATE,
        })
      : Effect.fail(new NotFoundError({ entity: "Message", id: messageId })),

  "agent.chat.getAttachments": ({ messageId }) =>
    messageId === "msg-stub-1"
      ? Effect.succeed([])
      : Effect.fail(new NotFoundError({ entity: "Message", id: messageId })),

  // --- 7B-4B Task 4: agent.post stubs -------------------------------------

  "agent.post.all": () =>
    Effect.succeed([
      {
        id: "post-stub-1",
        title: "Stub Post",
        content: "Stub content",
        createdAt: STUB_DATE,
      },
    ]),

  "agent.post.byId": ({ id }) =>
    Effect.succeed(
      id === "post-stub-1"
        ? {
            id: "post-stub-1",
            title: "Stub Post",
            content: "Stub content",
            createdAt: STUB_DATE,
          }
        : null,
    ),

  "agent.post.create": ({ title, content }) =>
    Effect.succeed({
      id: "post-stub-new",
      title,
      content,
      createdAt: STUB_DATE,
    }),

  "agent.post.delete": (_payload) =>
    Effect.succeed({ success: true }),

  // --- agent.persona (6) ----------------------------------------------------

  "agent.persona.create": ({
    name,
    slug,
    description,
    adapterId,
    model,
    systemPrompt,
    allowedTools,
    autonomyLevel,
    budgetLimitCents,
    metadata,
  }) =>
    Effect.succeed({
      ...STUB_PERSONA,
      name,
      slug,
      adapterId,
      description: description ?? null,
      model: model ?? null,
      systemPrompt: systemPrompt ?? null,
      allowedTools: allowedTools ?? null,
      autonomyLevel: autonomyLevel ?? null,
      budgetLimitCents: budgetLimitCents ?? null,
      metadata: metadata ?? {},
    } satisfies AgentPersonaWire),

  "agent.persona.list": (_payload) => Effect.succeed([STUB_PERSONA]),

  "agent.persona.get": ({ id }) =>
    id === STUB_PERSONA.id
      ? Effect.succeed(STUB_PERSONA)
      : Effect.fail(new PersonaNotFoundError({ personaId: id })),

  "agent.persona.update": ({ id, name, description }) =>
    id === STUB_PERSONA.id
      ? Effect.succeed({
          ...STUB_PERSONA,
          name: name ?? STUB_PERSONA.name,
          description: description ?? STUB_PERSONA.description,
        } satisfies AgentPersonaWire)
      : Effect.fail(new PersonaNotFoundError({ personaId: id })),

  "agent.persona.delete": ({ id }) =>
    id === STUB_PERSONA.id
      ? Effect.succeed(undefined)
      : Effect.fail(new PersonaNotFoundError({ personaId: id })),

  "agent.persona.syncRepo": (_payload) =>
    Effect.succeed({ created: 0, updated: 0, unchanged: 0 }),
});

/**
 * Stub handlers for the AgentRpc group.
 *
 * - `.layer` — `Layer.Layer<Rpc.ToHandler<AgentRpc>, never, never>` ready to
 *   be provided to `RpcServer.layerHttp`.
 * - `.handlers` — raw handler record keyed by RPC tag. Useful for unit tests
 *   that invoke a single handler directly without instantiating the full
 *   RPC server machinery.
 */
export const stubAgentHandlers = {
  layer: AgentRpc.toLayer(handlers),
  handlers,
  constants: {
    conversationId: STUB_CONVERSATION_ID,
    tenantId: STUB_TENANT_ID,
    userId: STUB_USER_ID,
    model: STUB_MODEL,
  },
} as const;
