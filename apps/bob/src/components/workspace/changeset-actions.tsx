"use client";

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@bob/ui/button";

import { useTRPC } from "~/trpc/react";

interface ChangesetActionsProps {
  worktreePath: string;
  onAction?: () => void;
}

type ActiveForm = "new" | "describe" | null;

export function ChangesetActions({
  worktreePath,
  onAction,
}: ChangesetActionsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [description, setDescription] = useState("");
  const [confirmSquash, setConfirmSquash] = useState(false);

  const invalidateAndNotify = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.git.jjLog.queryKey(),
    });
    onAction?.();
  }, [queryClient, trpc, onAction]);

  const newMutation = useMutation(
    trpc.git.jjNew.mutationOptions({
      onSuccess: () => {
        setActiveForm(null);
        setDescription("");
        invalidateAndNotify();
      },
    }),
  );

  const squashMutation = useMutation(
    trpc.git.jjSquash.mutationOptions({
      onSuccess: () => {
        setConfirmSquash(false);
        invalidateAndNotify();
      },
    }),
  );

  const describeMutation = useMutation(
    trpc.git.jjDescribe.mutationOptions({
      onSuccess: () => {
        setActiveForm(null);
        setDescription("");
        invalidateAndNotify();
      },
    }),
  );

  const handleNew = useCallback(() => {
    newMutation.mutate({
      path: worktreePath,
      description: description.trim() || undefined,
    });
  }, [newMutation, worktreePath, description]);

  const handleSquash = useCallback(() => {
    squashMutation.mutate({ path: worktreePath });
  }, [squashMutation, worktreePath]);

  const handleDescribe = useCallback(() => {
    if (!description.trim()) return;
    describeMutation.mutate({
      path: worktreePath,
      description: description.trim(),
    });
  }, [describeMutation, worktreePath, description]);

  const isLoading =
    newMutation.isPending ||
    squashMutation.isPending ||
    describeMutation.isPending;

  return (
    <div className="space-y-3">
      {/* Action buttons row */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={isLoading}
          onClick={() => {
            setActiveForm(activeForm === "new" ? null : "new");
            setDescription("");
            setConfirmSquash(false);
          }}
        >
          New
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isLoading}
          onClick={() => {
            if (confirmSquash) {
              handleSquash();
            } else {
              setConfirmSquash(true);
              setActiveForm(null);
            }
          }}
        >
          {confirmSquash ? "Confirm Squash?" : "Squash"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isLoading}
          onClick={() => {
            setActiveForm(activeForm === "describe" ? null : "describe");
            setDescription("");
            setConfirmSquash(false);
          }}
        >
          Describe
        </Button>

        {/* Cancel confirmation */}
        {confirmSquash && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmSquash(false)}
          >
            Cancel
          </Button>
        )}
      </div>

      {/* Inline form for New */}
      {activeForm === "new" && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNew();
              if (e.key === "Escape") setActiveForm(null);
            }}
            placeholder="Description (optional)"
            className="h-8 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <Button
            size="sm"
            variant="default"
            disabled={newMutation.isPending}
            onClick={handleNew}
          >
            {newMutation.isPending ? "Creating..." : "Create"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveForm(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Inline form for Describe */}
      {activeForm === "describe" && (
        <div className="space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleDescribe();
              if (e.key === "Escape") setActiveForm(null);
            }}
            placeholder="Enter description for working copy..."
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={describeMutation.isPending || !description.trim()}
              onClick={handleDescribe}
            >
              {describeMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveForm(null)}
            >
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">
              Cmd+Enter to save
            </span>
          </div>
        </div>
      )}

      {/* Error display */}
      {(newMutation.error ?? squashMutation.error ?? describeMutation.error) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {(newMutation.error ?? squashMutation.error ?? describeMutation.error)
            ?.message ?? "Action failed"}
        </div>
      )}
    </div>
  );
}
