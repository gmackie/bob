import { View, Text, ActivityIndicator } from "react-native";
import { trpc } from "../lib/trpc";
import {
  Avatar,
  AvatarFallback,
  AvatarFallbackText,
  AvatarImage,
} from "@linear-clone/ui-native";
import { tw, colors } from "../lib/styles";

interface CommentsListProps {
  issueId: string;
}

export function CommentsList({ issueId }: CommentsListProps) {
  const { data: comments, isLoading } = trpc.comment.list.useQuery(
    { issueId, includeReplies: true },
    { enabled: !!issueId }
  );

  const formatDate = (date: Date) => {
    const now = new Date();
    const commentDate = new Date(date);
    const diffMs = now.getTime() - commentDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return commentDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <View style={tw("py-4 items-center")}>
        <ActivityIndicator size="small" color="#4F46E5" />
      </View>
    );
  }

  if (!comments || comments.length === 0) {
    return (
      <View style={tw("py-6 items-center")}>
        <Text style={tw("text-gray-400 text-sm")}>No comments yet</Text>
        <Text style={tw("text-gray-300 text-xs mt-1")}>Be the first to comment</Text>
      </View>
    );
  }

  return (
    <View style={tw("gap-4")}>
      {comments.map((comment) => (
        <View key={comment.id} style={tw("flex-row")}>
          <Avatar style={{ height: 32, width: 32, marginRight: 12, marginTop: 2 }}>
            {comment.user?.avatarUrl ? (
              <AvatarImage src={comment.user.avatarUrl} />
            ) : null}
            <AvatarFallback style={{ backgroundColor: colors["indigo-100"] }}>
              <AvatarFallbackText style={{ fontSize: 12, color: colors["indigo-600"] }}>
                {getInitials(comment.user?.name ?? null)}
              </AvatarFallbackText>
            </AvatarFallback>
          </Avatar>
          <View style={tw("flex-1")}>
            <View style={tw("flex-row items-center gap-2 mb-1")}>
              <Text style={tw("text-sm font-medium text-gray-900")}>
                {comment.user?.name ?? "Unknown"}
              </Text>
              <Text style={tw("text-xs text-gray-400")}>
                {formatDate(comment.createdAt)}
              </Text>
              {comment.edited && (
                <Text style={tw("text-xs text-gray-400")}>(edited)</Text>
              )}
            </View>
            <Text style={[tw("text-gray-700 text-sm"), { lineHeight: 20 }]}>{comment.body}</Text>

            {comment.replies && comment.replies.length > 0 && (
              <View style={[tw("mt-3 pl-4 gap-3"), { borderLeftWidth: 2, borderLeftColor: colors["gray-200"] }]}>
                {comment.replies.map((reply) => (
                  <View key={reply.id} style={tw("flex-row")}>
                    <Avatar style={{ height: 24, width: 24, marginRight: 8, marginTop: 2 }}>
                      {reply.user?.avatarUrl ? (
                        <AvatarImage src={reply.user.avatarUrl} />
                      ) : null}
                      <AvatarFallback style={{ backgroundColor: colors["gray-100"] }}>
                        <AvatarFallbackText style={{ fontSize: 12, color: colors["gray-600"] }}>
                          {getInitials(reply.user?.name ?? null)}
                        </AvatarFallbackText>
                      </AvatarFallback>
                    </Avatar>
                    <View style={tw("flex-1")}>
                      <View style={[tw("flex-row items-center gap-2"), { marginBottom: 2 }]}>
                        <Text style={tw("text-xs font-medium text-gray-900")}>
                          {reply.user?.name ?? "Unknown"}
                        </Text>
                        <Text style={tw("text-xs text-gray-400")}>
                          {formatDate(reply.createdAt)}
                        </Text>
                      </View>
                      <Text style={tw("text-gray-600 text-sm")}>{reply.body}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
