"use client";

import { useState } from "react";
import { Button } from "@bob/ui/button";

export function DeviceApprovalClient({ userCode }: { userCode: string }) {
  const [state, setState] = useState<"idle" | "loading" | "approved" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleApprove() {
    setState("loading");
    try {
      const res = await fetch("/api/v1/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Approval failed");
      }

      setState("approved");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Approval failed");
      setState("error");
    }
  }

  if (state === "approved") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <svg
              className="h-6 w-6 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Approved
          </h1>
          <p className="text-sm text-muted-foreground">
            Your CLI has been authorized. You can close this tab.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Authorize Bob CLI
          </h1>
          <p className="text-sm text-muted-foreground">
            Confirm the code below matches what your terminal is showing.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-accent p-6 text-center">
          <p className="font-mono text-3xl font-bold tracking-widest">
            {userCode}
          </p>
        </div>

        {state === "error" && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <Button
          onClick={handleApprove}
          disabled={state === "loading"}
          className="w-full"
          size="lg"
        >
          {state === "loading" ? "Approving..." : "Approve"}
        </Button>
      </div>
    </main>
  );
}
