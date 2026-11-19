import { Redirect } from "expo-router";

import { DemoArcadeScreen } from "~/features/arcade/ArcadeScreen";

/** Dev builds only: the Arcade over a scripted SDLC feed, for screenshots and the wall demo (BOB-92). */
export default function ArcadeDemoRoute() {
  if (!__DEV__) return <Redirect href="/arcade" />;
  return <DemoArcadeScreen />;
}
