import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { RelatedAppsCard } from "~/features/links/RelatedAppsCard";
import { buildPrList, prStatusTone } from "~/features/pull-requests/pr-list-model";
import type { PrRow } from "~/features/pull-requests/pr-list-model";
import { trpc } from "~/utils/api";

/**
 * Pull requests, for review on the road.
 *
 * The question a person answers with a phone in one hand is "is anything
 * waiting on me?", so the list leads with work blocked on the reader rather
 * than sorting by date. Merged and closed work stays visible but sinks.
 *
 * Bob does not render the merge queue or check detail — ForgeGraph owns those
 * — so the link out sits at the bottom as an escape hatch.
 */
export default function PullRequestsScreen() {
  const query = useQuery(trpc.pullRequest.list.queryOptions({ limit: 50 }));
  const rows = buildPrList((query.data ?? []) as PrRow[]);

  return (
    <>
      <Stack.Screen options={{ title: "Pull Requests" }} />
      <ScrollView
        className="bg-background flex-1"
        contentContainerClassName="p-4 pb-12"
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        {query.isLoading ? <Text className="text-muted">Loading…</Text> : null}

        {!query.isLoading && rows.length === 0 ? (
          <Text className="text-muted text-sm leading-5">
            No pull requests yet. Ones Bob opens for you will appear here.
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <View className="border-border bg-card overflow-hidden rounded-lg border">
            {rows.map((row, index) => (
              <View
                key={row.id}
                className={`px-4 py-3 ${index > 0 ? "border-border border-t" : ""}`}
              >
                <View className="flex-row items-center gap-2">
                  {/* The one thing worth spotting from a train. */}
                  {row.needsYou ? (
                    <View className="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/30">
                      <Text className="text-[10px] font-semibold uppercase text-amber-900 dark:text-amber-300">
                        Needs you
                      </Text>
                    </View>
                  ) : null}
                  <View className={`rounded px-1.5 py-0.5 ${prStatusTone(row.status)}`}>
                    <Text className="text-[10px] font-semibold uppercase">{row.status}</Text>
                  </View>
                  <Text className="text-muted text-xs">#{row.number}</Text>
                </View>
                <Text className="text-foreground mt-1 text-sm font-medium" numberOfLines={2}>
                  {row.title}
                </Text>
                {row.repositoryName ? (
                  <Text className="text-muted mt-0.5 text-xs">{row.repositoryName}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <RelatedAppsCard requests={[{ target: "forgegraph.pullRequests" }]} />
      </ScrollView>
    </>
  );
}
