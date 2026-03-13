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

  return (
    <Screen className="pt-6">
      <Text className="text-foreground mb-4 text-3xl font-semibold tracking-tight">
        Inbox
      </Text>
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
                    url: item.url,
                    workItemId: item.workItemId,
                  }) as never,
                );
              }}
              showDivider={index < notificationsQuery.data.items.length - 1}
            />
          ))
        ) : (
          <Text className="text-muted text-sm">No notifications yet.</Text>
        )}
      </Card>
    </Screen>
  );
}
