import { confirmationSatisfies  } from "@bob/sdlc-view";
import type {CommandOption} from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { confirmationFor, confirmPrompt, itemTarget } from "./confirm-model";
import { must } from "./test-fixtures";

const cancelItem: CommandOption = { label: "Cancel item", tier: 2, destructive: true, command: { operation: "CancelItem", input: { itemId: "i1", expectedVersion: 3 } } };
const pause: CommandOption = { label: "Pause plan", tier: 1, command: { operation: "ControlPlan", input: { planId: "p1", expectedVersion: 1, action: "pause" } } };
const typed: CommandOption = { label: "Cancel plan", tier: 3, expected: "gmackie/bob", destructive: true, command: { operation: "ControlPlan", input: { planId: "p1", expectedVersion: 1, action: "cancel" } } };

describe("confirm model", () => {
  it("tier 1 needs no sheet and no confirm field", () => {
    expect(confirmPrompt(pause, "plan p1")).toBeNull();
    expect(confirmationFor(pause)).toBeUndefined();
  });

  it("tier 2 asks to confirm, naming the action and target", () => {
    const prompt = must(confirmPrompt(cancelItem, itemTarget("BOB-71", "1a2b3c4d5e")));
    expect(prompt).toMatchObject({ title: "Cancel item BOB-71 in plan 1a2b3c4d?", expected: null, destructive: true });
    const confirm = confirmationFor(cancelItem);
    expect(confirm).toEqual({ confirmed: true });
    expect(confirmationSatisfies(2, confirm ?? undefined)).toBe(true);
  });

  it("tier 3 confirms only with the expected text typed exactly", () => {
    expect(confirmPrompt(typed, "plan p1")?.expected).toBe("gmackie/bob");
    expect(confirmationFor(typed, "")).toBeNull();
    expect(confirmationFor(typed, "gmackie/Bob")).toBeNull();
    expect(confirmationFor(typed, "gmackie/bob ")).toBeNull();
    const ok = confirmationFor(typed, "gmackie/bob");
    expect(ok).toEqual({ confirmed: true, typed: "gmackie/bob" });
    expect(confirmationSatisfies(3, ok ?? undefined, "gmackie/bob")).toBe(true);
  });

  it("a tier 3 option without an expected text can never be confirmed", () => {
    expect(confirmationFor({ ...typed, expected: undefined }, "anything")).toBeNull();
    expect(confirmationFor({ ...typed, expected: undefined }, "")).toBeNull();
  });
});
