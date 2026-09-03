import { Text, View } from "react-native";

import { ExternalLinkButton } from "./ExternalLinkButton";
import type { ExternalLinkRequest } from "./external-links";

/**
 * Links to the sibling apps for one thing Bob is showing.
 *
 * Deliberately quiet. Bob is where review happens on the road, so these sit
 * below the content as an escape hatch for what Bob cannot do — not as a
 * competing set of primary actions. A card with nothing to link renders
 * nothing at all rather than an empty heading.
 */
export function RelatedAppsCard({
  requests,
  title = "Open elsewhere",
}: {
  requests: ExternalLinkRequest[];
  title?: string;
}) {
  if (requests.length === 0) return null;

  return (
    <View className="border-border bg-card mt-4 rounded-lg border p-4">
      <Text className="text-muted text-xs font-semibold uppercase tracking-wider">
        {title}
      </Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {requests.map((request) => (
          <ExternalLinkButton
            key={`${request.target}:${request.id ?? request.workspaceSlug ?? ""}`}
            request={request}
          />
        ))}
      </View>
    </View>
  );
}
