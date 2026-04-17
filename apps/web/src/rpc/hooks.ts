import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rpcClient } from "./client";

/* ------------------------------------------------------------------ */
/* Thread hooks                                                        */
/* ------------------------------------------------------------------ */

export function useThreadsList() {
  return useQuery({
    queryKey: ["threads", "list"],
    queryFn: () => rpcClient.threads.list(),
  });
}

export function useThreadById(id: string) {
  return useQuery({
    queryKey: ["threads", id],
    queryFn: () => rpcClient.threads.byId(id),
    enabled: !!id,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.threads.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads"] }),
  });
}

export function useUpdateThreadStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.threads.updateStatus,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Branch hooks                                                        */
/* ------------------------------------------------------------------ */

export function useBranchesByThread(threadId: string | undefined) {
  return useQuery({
    queryKey: ["branches", "listByThread", threadId],
    queryFn: () => rpcClient.branches.listByThread(threadId!),
    enabled: !!threadId,
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.branches.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useSetActiveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.branches.setActive,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branches"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Message hooks                                                       */
/* ------------------------------------------------------------------ */

export function useMessagesByBranch(
  threadId: string | undefined,
  branchId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["messages", "listByBranch", threadId, branchId],
    queryFn: () => rpcClient.messages.listByBranch(threadId!, branchId),
    enabled: !!threadId && enabled,
  });
}

export function useCreateMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.messages.create,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["messages", "listByBranch"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Agent hooks                                                         */
/* ------------------------------------------------------------------ */

export function useAgentChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.agent.chat,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["messages", "listByBranch"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Wiki hooks                                                          */
/* ------------------------------------------------------------------ */

export function useWikiSynthesize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcClient.wiki.synthesize,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki"] }),
  });
}

export function useWikiList() {
  return useQuery({
    queryKey: ["wiki", "list"],
    queryFn: () => rpcClient.wiki.list(),
  });
}

export function useWikiOrphans() {
  return useQuery({
    queryKey: ["wiki", "orphans"],
    queryFn: () => rpcClient.wiki.orphans(),
  });
}
