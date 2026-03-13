"use client";

import { useTransition } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useTRPC } from "~/trpc/react";

interface PromoteToTaskButtonProps {
  workItemId: string;
}

export function PromoteToTaskButton({
  workItemId,
}: PromoteToTaskButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const trpc = useTRPC();
  const promoteToTask = useMutation(
    trpc.workItems.promoteToTask.mutationOptions({
      onSuccess: () => {
        router.refresh();
      },
    }),
  );

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(() => {
          promoteToTask.mutate({ id: workItemId });
        });
      }}
      disabled={isPending || promoteToTask.isPending}
      className="inline-flex rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending || promoteToTask.isPending ? "Promoting..." : "Promote to task"}
    </button>
  );
}
