"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "@gmacko/core/ui/toast";
import { Button } from "@gmacko/core/ui/button";
import { Textarea } from "@gmacko/core/ui/textarea";

import { useTRPC } from "~/trpc/react";

interface AddCommentFormProps {
  issueId: string;
}

export function AddCommentForm({ issueId }: AddCommentFormProps) {
  const [body, setBody] = useState("");
  const router = useRouter();
  const trpc = useTRPC();

  const addComment = useMutation(
    trpc.planning.addComment.mutationOptions({
      onSuccess: () => {
        setBody("");
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addComment.mutate({ issueId, body: body.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment..."
        className="min-h-[60px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={!body.trim() || addComment.isPending}
        >
          {addComment.isPending ? "Posting..." : "Comment"}
        </Button>
      </div>
    </form>
  );
}
