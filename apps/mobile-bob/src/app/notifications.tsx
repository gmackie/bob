import { Redirect, router } from "expo-router";
import { ActivityIndicator, Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, ListRow, Screen } from "~/components/ui";
import {
  getNotificationDestination,
  getNotificationPreviewSubtitle,
} from "~/features/planning/notifications";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export default function NotificationsScreen() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery(
    trpc.notification.list.queryOptions(
      { limit: 50 },
      { enabled: Boolean(session) },
    ),
  );

  const markReadMutation = useMutation(
    trpc.notification.markAsRead.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.notification.list.queryKey({ limit: 50 }),
        });
      },
    }),
  );

  // Pull backstop: run-state transitions whose push may have been dropped by
  // APNs/FCM. The outbox ledger is the source of truth — anything unseen
  // shows here regardless of delivery.
  const unseenQuery = useQuery(
    trpc.notification.unseenTransitions.queryOptions(undefined, {
      enabled: Boolean(session),
    }),
  );
  const markSeenMutation = useMutation(
    trpc.notification.markTransitionsSeen.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.notification.unseenTransitions.queryKey(),
        });
      },
    }),
  );

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  if (notificationsQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  const unseenRows = unseenQuery.data?.rows ?? [];

  return (
    <Screen className="pt-6">
      <Text className="mb-4 text-3xl font-semibold tracking-tight text-foreground">
        Inbox
      </Text>
      {unseenRows.length > 0 ? (
        <Card className="mb-4">
          <Text className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
            Run updates you haven't seen ({unseenRows.length})
          </Text>
          {unseenRows.map((row, index) => {
            const payload = row.payload as { title?: string; body?: string } | null;
            return (
              <ListRow
                key={row.id}
                title={payload?.title ?? `Run ${row.transition}`}
                subtitle={payload?.body ?? row.transition}
                right={<Text className="text-sm text-muted">{row.transition}</Text>}
                onPress={() => {
                  markSeenMutation.mutate({ ids: [row.id] });
                  router.push(`/sessions/${row.sessionId}` as never);
                }}
                showDivider={index < unseenRows.length - 1}
              />
            );
          })}
        </Card>
      ) : null}
      <Card>
        {notificationsQuery.data?.items.length ? (
          notificationsQuery.data.items.map((item, index) => (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={getNotificationPreviewSubtitle({
                body: item.body,
                type: item.type,
              })}
              right={
                <Text className="text-sm text-muted">
                  {item.read ? "Read" : "Mark read"}
                </Text>
              }
              onPress={() => {
                if (!item.read) {
                  markReadMutation.mutate({ id: item.id });
                }

                router.push(
                  getNotificationDestination({
                    url: item.url,
                    workItemId: item.workItemId,
                  }) as never,
                );
              }}
              showDivider={index < notificationsQuery.data.items.length - 1}
            />
          ))
        ) : (
          <Text className="text-sm text-muted">No notifications yet.</Text>
        )}
      </Card>
    </Screen>
  );
}
