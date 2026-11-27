import { expect, it } from "vitest";
import type { Beat } from "@bob/arcade";

import { floorCue } from "./floor-model";

it("plays outcomes only for work on the selected floor", () => {
  const beat: Beat = { id: "ci", at: 0, seq: 1, epoch: "e", source: "forgegraph", kind: "ci.green", subject: { itemId: "A" } };
  expect(floorCue(beat, new Set(["B"]))).toBeNull();
  expect(floorCue(beat, new Set(["A"]))).toBe("pr");
  expect(floorCue({ ...beat, kind: "item.failed" })).toBe("failure");
  expect(floorCue({ ...beat, kind: "agent.activity" })).toBeNull();
});
