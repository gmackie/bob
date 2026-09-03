import { Linking, Pressable, Text } from "react-native";

import { buildExternalLink, linkAffordance } from "./external-links";
import type { ExternalLinkRequest } from "./external-links";
import { useExternalLinkConfig } from "./config";

/**
 * Opens a sibling app, falling back to the web.
 *
 * Rendered as a SECONDARY action wherever Bob already shows the thing — a
 * Kanbanger issue, say. Bob is where review happens on the road; a link out
 * exists for what Bob cannot do, not for reading what is already on screen.
 */
export function ExternalLinkButton({
  request,
  className,
}: {
  request: ExternalLinkRequest;
  className?: string;
}) {
  const config = useExternalLinkConfig();
  const link = buildExternalLink(request, config);

  // Unconfigured app, or a detail target with no id: render nothing rather
  // than an affordance that dead-ends.
  if (!link) return null;

  const affordance = linkAffordance(request.target);
  const isSecondary = affordance.primary === "in_app";

  const open = () => {
    // Try the app first; `canOpenURL` is unreliable across iOS versions
    // without a declared scheme, so attempt and fall back on rejection.
    Linking.openURL(link.appUrl).catch(() => {
      void Linking.openURL(link.webUrl).catch(() => undefined);
    });
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={link.label}
      className={
        className ??
        (isSecondary
          ? "self-start px-1 py-1 active:opacity-60"
          : "border-border self-start rounded-md border px-3 py-1.5 active:opacity-70")
      }
    >
      <Text className={isSecondary ? "text-muted text-xs" : "text-foreground text-sm font-medium"}>
        {link.label} ↗
      </Text>
    </Pressable>
  );
}
