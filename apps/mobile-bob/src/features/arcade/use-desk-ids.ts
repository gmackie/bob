// Which items get an Arcade desk (BOB-98), sticky across views: chooseDesks() is given the
// previous choice, and an unchanged choice keeps the same array so the watch is not re-sent.
// A floor scope (BOB-91 slice 3) narrows the desks to that project or repo.
import { useState } from "react";
import { chooseDesks, sameDesks } from "@bob/arcade";
import type { EdgeView, Scope } from "@bob/sdlc-view";

const NO_SCOPE: Scope = {};

/** `now` should change rarely (a minute clock): it re-judges stalls and so re-chooses desks. */
export function useDeskIds(view: EdgeView, now: number, scope: Scope = NO_SCOPE): readonly string[] {
  const [held, setHeld] = useState(() => ({ view, now, scope, ids: chooseDesks(view, [], { now, scope }) }));
  if (held.view !== view || held.now !== now || held.scope !== scope) {
    const next = chooseDesks(view, held.ids, { now, scope });
    const ids = sameDesks(next, held.ids) ? held.ids : next;
    setHeld({ view, now, scope, ids });
    return ids;
  }
  return held.ids;
}
