// Which items get an Arcade desk (BOB-98), sticky across views: chooseDesks() is given the
// previous choice, and an unchanged choice keeps the same array so the watch is not re-sent.
import { useState } from "react";
import { chooseDesks, sameDesks } from "@bob/arcade";
import type { EdgeView } from "@bob/sdlc-view";

export function useDeskIds(view: EdgeView): readonly string[] {
  const [held, setHeld] = useState(() => ({ view, ids: chooseDesks(view) }));
  if (held.view !== view) {
    const next = chooseDesks(view, held.ids);
    const ids = sameDesks(next, held.ids) ? held.ids : next;
    setHeld({ view, ids });
    return ids;
  }
  return held.ids;
}
