// Plays demoFeed() through the real edge reducer on a timer (dev-only demo mode).
import { useEffect, useState } from "react";
import { emptyView, reduce } from "@bob/sdlc-view";
import type { EdgeView } from "@bob/sdlc-view";

import { DEMO_STEP_MS, demoFeed } from "./demo-feed";

const STEP_MS = DEMO_STEP_MS;
const REST_MS = 4_000;

export function useDemoEdge(): EdgeView {
  const [view, setView] = useState<EdgeView>(emptyView);
  useEffect(() => {
    let run = 0;
    let feed = demoFeed(`demo-${run}`, Date.now());
    let i = -1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (i === -1) setView(reduce(emptyView(), feed.snapshot));
      else {
        const delta = feed.deltas[i];
        if (delta) setView((v) => reduce(v, delta));
      }
      i++;
      if (i > feed.deltas.length) {
        // A new epoch: the screen treats it as a fresh baseline, as with a reset edge.
        run++;
        feed = demoFeed(`demo-${run}`, Date.now());
        i = -1;
        timer = setTimeout(tick, REST_MS);
        return;
      }
      timer = setTimeout(tick, STEP_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return view;
}
