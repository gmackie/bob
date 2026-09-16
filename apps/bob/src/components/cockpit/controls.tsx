"use client";

/**
 * Ops-mode controls — thin buttons over the cockpit tRPC mutations. All
 * owner-only server-side; the UI just surfaces them. Destructive ones confirm.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useBobQueryClient } from "~/rpc/react";

export function useCockpitActions() {
  const bobQuery = useBobQueryClient();
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: bobQuery("cockpit.status").queryKey(),
      }),
    [queryClient, bobQuery],
  );
  const opts = { onSettled: refresh };
  return {
    stopSession: useMutation(
      bobQuery("cockpit.stopSession").mutationOptions(opts),
    ),
    retryItem: useMutation(bobQuery("cockpit.retryItem").mutationOptions(opts)),
    bumpPriority: useMutation(
      bobQuery("cockpit.bumpPriority").mutationOptions(opts),
    ),
    setDispatchEnabled: useMutation(
      bobQuery("cockpit.setDispatchEnabled").mutationOptions(opts),
    ),
    setBudget: useMutation(bobQuery("cockpit.setBudget").mutationOptions(opts)),
    setAgentEnabled: useMutation(
      bobQuery("cockpit.setAgentEnabled").mutationOptions(opts),
    ),
    triggerReview: useMutation(
      bobQuery("cockpit.triggerReview").mutationOptions(opts),
    ),
    reviewPr: useMutation(bobQuery("cockpit.reviewPr").mutationOptions(opts)),
  };
}

export type CockpitActions = ReturnType<typeof useCockpitActions>;

export function OpsButton({
  label,
  onClick,
  confirm,
  tone = "neutral",
  busy,
}: {
  label: string;
  onClick: () => void;
  confirm?: string;
  tone?: "neutral" | "danger" | "go";
  busy?: boolean;
}) {
  const [arming, setArming] = useState(false);
  const cls =
    tone === "danger"
      ? "border-red-500/50 text-red-300 hover:bg-red-500/15"
      : tone === "go"
        ? "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/15"
        : "border-white/20 text-white/70 hover:bg-white/10";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (confirm && !arming) {
          setArming(true);
          setTimeout(() => setArming(false), 3000);
          return;
        }
        setArming(false);
        onClick();
      }}
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-40 ${arming ? "border-amber-400 text-amber-300" : cls}`}
    >
      {arming ? (confirm ?? "sure?") : busy ? "…" : label}
    </button>
  );
}
