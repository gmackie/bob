import { router, useLocalSearchParams } from "expo-router";

import { ArcadeScreen, DemoArcadeScreen } from "~/features/arcade/ArcadeScreen";
import { itemHref } from "~/features/sdlc/attention-model";

/** Bob Arcade: watch agents work the SDLC live (BOB-92). ?demo=1 plays a scripted feed in dev builds. */
export default function ArcadeRoute() {
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  if (__DEV__ && demo === "1") return <DemoArcadeScreen />;
  return <ArcadeScreen onOpenItem={(itemId) => router.push(itemHref(itemId))} />;
}
