import type {
  Thread,
  CreateThreadInput,
  UpdateThreadStatusInput,
  Branch,
  CreateBranchInput,
  SetActiveBranchInput,
  Message,
  CreateMessageInput,
  ChatInput,
  WikiArticle,
  SynthesizeInput,
  SynthesizeResult,
} from "@gmacko/contracts";
import { METHODS } from "@gmacko/contracts";

/* ------------------------------------------------------------------ */
/* Effect-RPC HTTP protocol client                                     */
/*                                                                     */
/* The Effect RPC HTTP server expects a POST with a JSON body that is  */
/* an array of FromClientEncoded messages. Each request message has:    */
/*   { _tag: "Request", id: string, tag: string, payload, headers }   */
/* The response is a JSON array of FromServerEncoded messages.          */
/* ------------------------------------------------------------------ */

const RPC_URL =
  typeof window !== "undefined"
    ? "/rpc" // In browser: same-origin proxy via next.config.ts rewrites
    : "http://localhost:3001/rpc";

let requestCounter = 0;

interface RpcRequestEncoded {
  readonly _tag: "Request";
  readonly id: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly headers: ReadonlyArray<[string, string]>;
}

interface RpcEof {
  readonly _tag: "Eof";
}

interface RpcResponseExitEncoded {
  readonly _tag: "Exit";
  readonly requestId: string;
  readonly exit:
    | { readonly _tag: "Success"; readonly value: unknown }
    | {
        readonly _tag: "Failure";
        readonly cause: ReadonlyArray<
          | { readonly _tag: "Fail"; readonly error: unknown }
          | { readonly _tag: "Die"; readonly defect: unknown }
          | { readonly _tag: "Interrupt"; readonly fiberId: number | undefined }
        >;
      };
}

async function rpcCall<T>(method: string, payload: unknown = {}): Promise<T> {
  const id = String(++requestCounter);

  const messages: Array<RpcRequestEncoded | RpcEof> = [
    { _tag: "Request", id, tag: method, payload, headers: [] },
    { _tag: "Eof" },
  ];

  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? `RPC call failed: ${res.status}`);
  }

  const responses: Array<RpcResponseExitEncoded> = await res.json();

  // Find the exit response matching our request id
  const exit = responses.find(
    (r) => r._tag === "Exit" && r.requestId === id,
  ) as RpcResponseExitEncoded | undefined;

  if (!exit) {
    throw new Error(`No response for RPC request ${method}`);
  }

  if (exit.exit._tag === "Success") {
    return exit.exit.value as T;
  }

  // Handle failure
  const cause = exit.exit.cause;
  const fail = cause.find((c) => c._tag === "Fail");
  if (fail) {
    const err = fail.error as Record<string, unknown>;
    throw new Error(
      (err?.message as string) ?? (err?._tag as string) ?? "RPC call failed",
    );
  }
  const die = cause.find((c) => c._tag === "Die");
  if (die) {
    throw new Error(String(die.defect));
  }
  throw new Error("RPC call was interrupted");
}

/* ------------------------------------------------------------------ */
/* Typed RPC client                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* SSE streaming client for agent chat                                 */
/* ------------------------------------------------------------------ */

const STREAM_URL =
  typeof window !== "undefined"
    ? "/api/chat/stream"
    : "http://localhost:3001/api/chat/stream";

export async function streamChat(
  input: { threadId: string; branchId: string; content: string },
  onToken: (text: string) => void,
  onDone: (messageId: string) => void,
) {
  const res = await fetch(STREAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`Stream request failed: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "token") onToken(data.text);
        if (data.type === "done") onDone(data.messageId);
        if (data.type === "error") throw new Error(data.message);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Typed RPC client                                                    */
/* ------------------------------------------------------------------ */

export const rpcClient = {
  threads: {
    list: () => rpcCall<Thread[]>(METHODS.threadsList),
    byId: (id: string) => rpcCall<Thread>(METHODS.threadsById, { id }),
    create: (input: typeof CreateThreadInput.Type) =>
      rpcCall<Thread>(METHODS.threadsCreate, input),
    updateStatus: (input: typeof UpdateThreadStatusInput.Type) =>
      rpcCall<Thread>(METHODS.threadsUpdateStatus, input),
  },
  branches: {
    listByThread: (threadId: string) =>
      rpcCall<Branch[]>(METHODS.branchesListByThread, { threadId }),
    create: (input: typeof CreateBranchInput.Type) =>
      rpcCall<Branch>(METHODS.branchesCreate, input),
    setActive: (input: typeof SetActiveBranchInput.Type) =>
      rpcCall<void>(METHODS.branchesSetActive, input),
  },
  messages: {
    listByBranch: (threadId: string, branchId: string) =>
      rpcCall<Message[]>(METHODS.messagesListByBranch, {
        threadId,
        branchId,
      }),
    create: (input: typeof CreateMessageInput.Type) =>
      rpcCall<Message>(METHODS.messagesCreate, input),
  },
  agent: {
    chat: (input: typeof ChatInput.Type) =>
      rpcCall<Message>(METHODS.agentChat, input),
  },
  wiki: {
    synthesize: (input: typeof SynthesizeInput.Type) =>
      rpcCall<typeof SynthesizeResult.Type>(METHODS.wikiSynthesize, input),
    list: () => rpcCall<WikiArticle[]>(METHODS.wikiList),
    orphans: () => rpcCall<string[]>(METHODS.wikiOrphans),
  },
  exploration: {
    start: (input: {
      threadId: string;
      branchId: string;
      topic: string;
      maxDepth?: number;
    }) => rpcCall<unknown>(METHODS.explorationStart, input),
    respond: (input: {
      explorationId: string;
      checkInId: string;
      direction: string;
      redirectTopic?: string;
    }) => rpcCall<unknown>(METHODS.explorationRespond, input),
    status: (explorationId: string) =>
      rpcCall<unknown>(METHODS.explorationStatus, { explorationId }),
    list: () => rpcCall<unknown[]>(METHODS.explorationList),
  },
};
