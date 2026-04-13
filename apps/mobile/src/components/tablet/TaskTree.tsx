import { useState } from "react";
import { Text, View, Pressable, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { hapticLight } from "~/lib/haptics";

const STATUS_COLORS: Record<string, string> = {
  in_progress: colors.success,
  in_review: colors.accent,
  blocked: colors.warning,
  done: colors.muted,
  cancelled: colors.muted2,
  backlog: colors.muted2,
  ready: colors.primary,
};

interface TaskTreeNodeProps {
  item: { id: string; identifier: string; title: string; kind: string; status: string; childCount?: number };
  workspaceId: string;
  depth: number;
}

function TaskTreeNode({ item, workspaceId, depth }: TaskTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = (item.childCount ?? 0) > 0;

  // @ts-expect-error — tRPC type inference depth exceeded (pre-existing)
  const childrenQuery = useQuery(trpc.workItem.list.queryOptions(
    { workspaceId, parentId: item.id, limit: 50 },
    { enabled: expanded && hasChildren },
  ));

  const children = (childrenQuery.data ?? []) as Array<{
    id: string; identifier: string; title: string; kind: string; status: string; childCount?: number;
  }>;

  return (
    <View>
      <Pressable
        onPress={() => {
          if (hasChildren) {
            hapticLight();
            setExpanded((v) => !v);
          }
        }}
        className="flex-row items-center py-2 active:opacity-70"
        style={{ paddingLeft: 16 + depth * 20, minHeight: 40 }}
        accessibilityRole="button"
        accessibilityLabel={`${item.identifier} ${item.title}, ${item.status}`}
        accessibilityState={{ expanded: hasChildren ? expanded : undefined }}
      >
        {/* Expand/collapse indicator */}
        {hasChildren ? (
          <Text className="mr-2 text-xs" style={{ color: colors.muted, width: 16 }}>
            {expanded ? "▾" : "▸"}
          </Text>
        ) : (
          <View style={{ width: 16, marginRight: 8 }} />
        )}

        {/* Status dot */}
        <View
          style={{
            width: 6, height: 6, borderRadius: 3, marginRight: 8,
            backgroundColor: STATUS_COLORS[item.status] ?? colors.muted,
          }}
        />

        {/* Content */}
        <View className="flex-1">
          <Text className="text-sm" style={{ color: colors.foreground }} numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="text-xs" style={{ color: colors.muted }}>
            {item.identifier} · {item.status.replace(/_/g, " ")}
          </Text>
        </View>
      </Pressable>

      {/* Children */}
      {expanded && hasChildren && (
        childrenQuery.isLoading ? (
          <View style={{ paddingLeft: 36 + depth * 20, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={colors.muted} />
          </View>
        ) : (
          children.map((child) => (
            <TaskTreeNode
              key={child.id}
              item={child}
              workspaceId={workspaceId}
              depth={depth + 1}
            />
          ))
        )
      )}
    </View>
  );
}

interface TaskTreeProps {
  workItemId: string;
  workspaceId?: string;
}

export function TaskTree({ workItemId, workspaceId: providedWsId }: TaskTreeProps) {
  // If workspaceId not provided, fetch the work item to get it
  // @ts-expect-error — tRPC type inference depth exceeded (pre-existing)
  const itemQuery = useQuery(trpc.workItem.get.queryOptions(
    { id: workItemId },
    { enabled: Boolean(workItemId) && !providedWsId },
  ));
  const workspaceId = providedWsId ?? (itemQuery.data as { workspaceId?: string } | undefined)?.workspaceId;

  // @ts-expect-error — tRPC type inference depth exceeded (pre-existing)
  const childrenQuery = useQuery(trpc.workItem.list.queryOptions(
    { workspaceId: workspaceId ?? "", parentId: workItemId, limit: 50 },
    { enabled: Boolean(workItemId && workspaceId) },
  ));

  const children = (childrenQuery.data ?? []) as Array<{
    id: string; identifier: string; title: string; kind: string; status: string; childCount?: number;
  }>;

  if (childrenQuery.isLoading) {
    return (
      <View className="items-center justify-center py-8">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (children.length === 0) {
    return (
      <View className="items-center justify-center px-4 py-8">
        <Text className="text-sm" style={{ color: colors.muted }}>No subtasks</Text>
      </View>
    );
  }

  return (
    <View>
      {children.map((child) => (
        <TaskTreeNode
          key={child.id}
          item={child}
          workspaceId={workspaceId!}
          depth={0}
        />
      ))}
    </View>
  );
}
