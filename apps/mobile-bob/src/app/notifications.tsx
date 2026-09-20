import { ActivityIndicator, Text, RefreshControl, ScrollView } from "react-native";
import { Redirect, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, ListRow, Screen } from "~/components/ui";
import {
  getNotificationDestination,
  getNotificationPreviewSubtitle,
} from "~/features/planning/notifications";
import { rpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

export default function NotificationsScreen() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery(
    rpc("workItem.notification.list").queryOptions(
      { limit: 50 },
      { enabled: Boolean(session) },
    ),
  );

  const markReadMutation = useMutation(
    rpc("workItem.notification.markAsRead").mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: rpc("workItem.notification.list").queryKey({ limit: 50 }),
        });
      },
    }),
  );

  // Pull backstop: run-state transitions whose push may have been dropped by
  // APNs/FCM. The outbox ledger is the source of truth — anything unseen
  // shows here regardless of delivery.
  const unseenQuery = useQuery(
    rpc("notification.unseenTransitions").queryOptions(undefined, {
      enabled: Boolean(session),
    }),
  );
  const markSeenMutation = useMutation(
    rpc("notification.markTransitionsSeen").mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: rpc("notification.unseenTransitions").queryKey(),
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
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={notificationsQuery.isRefetching}
            onRefresh={() => void notificationsQuery.refetch()}
          />
        }
      >
        <Text className="text-foreground mb-4 text-3xl font-semibold tracking-tight">
          Inbox
        </Text>
        {unseenRows.length > 0 ? (
          <Card className="mb-4">
            <Text className="text-muted mb-2 text-xs tracking-[0.18em] uppercase">
              Run updates you haven't seen ({unseenRows.length})
            </Text>
            {unseenRows.map((row, index) => {
              const payload = row.payload as {
                title?: string;
                body?: string;
              } | null;
              return (
                <ListRow
                  key={row.id}
                  title={payload?.title ?? `Run ${row.transition}`}
                  subtitle={payload?.body ?? row.transition}
                  right={
                    <Text className="text-muted text-sm">{row.transition}</Text>
                  }
                  onPress={() => {
                    markSeenMutation.mutate({ ids: [row.id] });
                    router.push(`/sessions/${row.sessionId}`);
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
                  body: item.body ?? null,
                  type: item.type,
                })}
                right={
                  <Text className="text-muted text-sm">
                    {item.read ? "Read" : "Mark read"}
                  </Text>
                }
                onPress={() => {
                  if (!item.read) {
                    markReadMutation.mutate({ id: item.id });
                  }

                  router.push(
                    getNotificationDestination({
                      url: item.url ?? null,
                      workItemId: item.workItemId ?? null,
                    }),
                  );
                }}
                showDivider={index < notificationsQuery.data.items.length - 1}
              />
            ))
          ) : (
            <Text className="text-muted text-sm">No notifications yet.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
