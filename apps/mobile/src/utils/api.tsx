import { QueryClient } from "@tanstack/react-query";
import type {
  Thread, Branch, Message, WikiArticle,
} from "@gmacko/contracts";
import { METHODS } from "@gmacko/contracts";
import { getBaseUrl } from "./base-url";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

async function rpcCall<T>(method: string, payload: unknown = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-rpc-source": "expo" },
    body: JSON.stringify({ method, payload }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? "RPC call failed");
  }
  return res.json();
}

export const rpc = {
  threads: {
    list: () => rpcCall<Thread[]>(METHODS.threadsList),
    byId: (id: string) => rpcCall<Thread>(METHODS.threadsById, { id }),
    create: (input: { title: string; tags?: string[] }) =>
      rpcCall<Thread>(METHODS.threadsCreate, input),
  },
  messages: {
    listByBranch: (threadId: string, branchId: string) =>
      rpcCall<Message[]>(METHODS.messagesListByBranch, { threadId, branchId }),
  },
  agent: {
    chat: (input: { threadId: string; branchId: string; content: string }) =>
      rpcCall<Message>(METHODS.agentChat, input),
  },
  wiki: {
    list: () => rpcCall<WikiArticle[]>(METHODS.wikiList),
  },
};
