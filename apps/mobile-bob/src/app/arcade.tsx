import { router } from "expo-router";

import { ArcadeScreen } from "~/features/arcade/ArcadeScreen";
import { itemHref } from "~/features/sdlc/attention-model";

/** Bob Arcade: watch agents work the SDLC live (BOB-92). */
export default function ArcadeRoute() {
  return <ArcadeScreen onOpenItem={(itemId) => router.push(itemHref(itemId))} />;
}
