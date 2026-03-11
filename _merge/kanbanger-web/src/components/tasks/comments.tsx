"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@linear-clone/ui/components/avatar";
import { Button } from "@linear-clone/ui/components/button";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  Send,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  MessageSquare,
  SmilePlus,
} from "lucide-react";

interface CommentUser {
  id: string;
  name: string | null;
  email?: string;
  avatarUrl: string | null;
}

interface CommentReaction {
  emoji: string;
  userId: string;
}

interface Reply {
  id: string;
  body: string;
  edited: boolean;
  createdAt: Date;
  user: CommentUser;
  reactions: CommentReaction[];
}

interface Comment {
  id: string;
  body: string;
  edited: boolean;
  createdAt: Date;
  user: CommentUser;
  reactions: CommentReaction[];
  replies: Reply[];
}

interface CommentsProps {
  comments: Comment[];
  isLoading?: boolean;
  currentUser?: CommentUser;
  onSubmit?: (body: string, parentId?: string) => Promise<void>;
  onEdit?: (commentId: string, body: string) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
  onAddReaction?: (commentId: string, emoji: string) => Promise<void>;
  onRemoveReaction?: (commentId: string, emoji: string) => Promise<void>;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function CommentItem({
  comment,
  currentUser,
  onEdit,
  onDelete,
  onReply,
  onAddReaction,
  isReply = false,
}: {
  comment: Comment | Reply;
  currentUser?: CommentUser;
  onEdit?: (body: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onReply?: () => void;
  onAddReaction?: (emoji: string) => Promise<void>;
  isReply?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const isOwner = currentUser?.id === comment.user.id;

  const handleEdit = async () => {
    if (!editBody.trim() || !onEdit) return;
    setIsSubmitting(true);
    try {
      await onEdit(editBody.trim());
      setIsEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsSubmitting(true);
    try {
      await onDelete();
    } finally {
      setIsSubmitting(false);
    }
  };

  const groupedReactions = comment.reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={cn("group flex gap-3", isReply && "ml-10")}>
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarImage src={comment.user.avatarUrl ?? ""} />
        <AvatarFallback className="text-xs">
          {comment.user.name?.charAt(0) ?? "?"}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{comment.user.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {comment.edited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>

        {isEditing ? (
          <div className="mt-1 space-y-2">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
              disabled={isSubmitting}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleEdit}
                disabled={!editBody.trim() || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditBody(comment.body);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>

            {Object.keys(groupedReactions).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(groupedReactions).map(([emoji, count]) => (
                  <button
                    key={emoji}
                    onClick={() => onAddReaction?.(emoji)}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/80"
                  >
                    <span>{emoji}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isReply && onReply && (
                <button
                  onClick={onReply}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Reply
                </button>
              )}
              <button
                onClick={() => onAddReaction?.("👍")}
                className="p-1 rounded hover:bg-muted"
              >
                <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {isOwner && (
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1 rounded hover:bg-muted"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {showMenu && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-32 rounded-md border border-border bg-popover p-1 shadow-md">
                      <button
                        onClick={() => {
                          setIsEditing(true);
                          setShowMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          handleDelete();
                          setShowMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-red-500 hover:bg-muted"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Comments({
  comments,
  isLoading,
  currentUser,
  onSubmit,
  onEdit,
  onDelete,
  onAddReaction,
}: CommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const handleSubmit = async () => {
    if (!newComment.trim() || !onSubmit) return;
    setIsSubmitting(true);
    try {
      await onSubmit(newComment.trim());
      setNewComment("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async (parentId: string) => {
    if (!replyText.trim() || !onSubmit) return;
    setIsSubmitting(true);
    try {
      await onSubmit(replyText.trim(), parentId);
      setReplyText("");
      setReplyingTo(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading comments...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        <h4 className="text-sm font-medium">
          Comments {comments.length > 0 && `(${comments.length})`}
        </h4>
      </div>

      <div className="flex gap-3">
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={currentUser?.avatarUrl ?? ""} />
          <AvatarFallback className="text-xs">
            {currentUser?.name?.charAt(0) ?? "U"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="relative">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a comment... (⌘+Enter to submit)"
              className="w-full min-h-[60px] rounded-md border border-border bg-background p-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
              disabled={isSubmitting}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 bottom-1 h-7 w-7"
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {comments.map((comment) => (
          <div key={comment.id} className="space-y-3">
            <CommentItem
              comment={comment}
              currentUser={currentUser}
              onEdit={onEdit ? async (body) => onEdit(comment.id, body) : undefined}
              onDelete={onDelete ? async () => onDelete(comment.id) : undefined}
              onReply={() => setReplyingTo(comment.id)}
              onAddReaction={onAddReaction ? async (emoji) => onAddReaction(comment.id, emoji) : undefined}
            />

            {"replies" in comment && comment.replies.length > 0 && (
              <div className="space-y-3">
                {comment.replies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    currentUser={currentUser}
                    onEdit={onEdit ? async (body) => onEdit(reply.id, body) : undefined}
                    onDelete={onDelete ? async () => onDelete(reply.id) : undefined}
                    onAddReaction={onAddReaction ? async (emoji) => onAddReaction(reply.id, emoji) : undefined}
                    isReply
                  />
                ))}
              </div>
            )}

            {replyingTo === comment.id && (
              <div className="ml-10 flex gap-3">
                <Avatar className="h-6 w-6 flex-shrink-0">
                  <AvatarImage src={currentUser?.avatarUrl ?? ""} />
                  <AvatarFallback className="text-[10px]">
                    {currentUser?.name?.charAt(0) ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <textarea
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply..."
                    className="w-full min-h-[50px] rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
                    disabled={isSubmitting}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleReply(comment.id)}
                      disabled={!replyText.trim() || isSubmitting}
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Reply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyText("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comments yet. Start the conversation!
          </p>
        )}
      </div>
    </div>
  );
}
