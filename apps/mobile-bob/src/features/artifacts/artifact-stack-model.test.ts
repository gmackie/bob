import { describe, expect, it } from "vitest";

import {
  ARTIFACT_STACK_LIMIT,
  EMPTY_ARTIFACT_STACK,
  artifactStackReducer,
  topArtifact,
} from "./artifact-stack-model";
import type { ArtifactStackState } from "./artifact-stack-model";
import type { ArtifactRef } from "./types";

function web(id: string): ArtifactRef {
  return { type: "web", id, title: `Link ${id}`, url: `https://example.com/${id}` };
}

function proposal(id: string, status?: string): ArtifactRef {
  return { type: "proposal", id, title: `Proposal ${id}`, proposalId: `p-${id}`, status };
}

function reduce(state: ArtifactStackState, ...actions: Parameters<typeof artifactStackReducer>[1][]) {
  return actions.reduce(artifactStackReducer, state);
}

describe("artifactStackReducer", () => {
  it("starts empty with a null top", () => {
    expect(EMPTY_ARTIFACT_STACK.stack).toEqual([]);
    expect(topArtifact(EMPTY_ARTIFACT_STACK)).toBeNull();
  });

  it("open pushes onto the stack and exposes the top", () => {
    const state = reduce(EMPTY_ARTIFACT_STACK, { type: "open", ref: web("a") }, { type: "open", ref: web("b") });
    expect(state.stack.map((r) => r.id)).toEqual(["a", "b"]);
    expect(topArtifact(state)?.id).toBe("b");
  });

  it("open with an existing id moves it to the top instead of duplicating", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: web("a") },
      { type: "open", ref: web("b") },
      { type: "open", ref: web("c") },
      { type: "open", ref: { ...web("a"), title: "Refreshed" } },
    );
    expect(state.stack.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(topArtifact(state)?.title).toBe("Refreshed");
  });

  it("open with replace swaps the top item", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: web("a") },
      { type: "open", ref: web("b") },
      { type: "open", ref: web("c"), replace: true },
    );
    expect(state.stack.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("open with replace on an empty stack simply pushes", () => {
    const state = reduce(EMPTY_ARTIFACT_STACK, { type: "open", ref: web("a"), replace: true });
    expect(state.stack.map((r) => r.id)).toEqual(["a"]);
  });

  it("open with replace for an already-stacked id dedupes rather than dropping the top", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: web("a") },
      { type: "open", ref: web("b") },
      { type: "open", ref: web("a"), replace: true },
    );
    expect(state.stack.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("back pops one item", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: web("a") },
      { type: "open", ref: web("b") },
      { type: "back" },
    );
    expect(state.stack.map((r) => r.id)).toEqual(["a"]);
    expect(topArtifact(state)?.id).toBe("a");
  });

  it("back on an empty stack is a no-op and returns the same state", () => {
    const state = artifactStackReducer(EMPTY_ARTIFACT_STACK, { type: "back" });
    expect(state).toBe(EMPTY_ARTIFACT_STACK);
  });

  it("close clears everything", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: web("a") },
      { type: "open", ref: web("b") },
      { type: "close" },
    );
    expect(state.stack).toEqual([]);
    expect(topArtifact(state)).toBeNull();
  });

  it("update patches matching id anywhere in the stack", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: proposal("p1", "pending") },
      { type: "open", ref: web("a") },
      { type: "update", id: "p1", patch: { status: "approved" } },
    );
    const updated = state.stack[0];
    expect(updated?.type).toBe("proposal");
    expect(updated && "status" in updated ? updated.status : undefined).toBe("approved");
    expect(state.stack[1]?.id).toBe("a");
  });

  it("update ignores patches that would change the discriminant", () => {
    const before = reduce(EMPTY_ARTIFACT_STACK, { type: "open", ref: proposal("p1", "pending") });
    const after = artifactStackReducer(before, {
      type: "update",
      id: "p1",
      patch: { type: "web", title: "nope" },
    });
    expect(after).toBe(before);
    expect(after.stack[0]?.type).toBe("proposal");
  });

  it("update with the same discriminant still applies the rest of the patch", () => {
    const state = reduce(
      EMPTY_ARTIFACT_STACK,
      { type: "open", ref: proposal("p1") },
      { type: "update", id: "p1", patch: { type: "proposal", title: "Renamed" } },
    );
    expect(state.stack[0]?.title).toBe("Renamed");
  });

  it("update for an unknown id is a no-op", () => {
    const before = reduce(EMPTY_ARTIFACT_STACK, { type: "open", ref: web("a") });
    const after = artifactStackReducer(before, { type: "update", id: "zzz", patch: { title: "x" } });
    expect(after).toBe(before);
  });

  it("caps the stack at the limit by dropping the oldest", () => {
    let state = EMPTY_ARTIFACT_STACK;
    for (let i = 0; i < ARTIFACT_STACK_LIMIT + 3; i += 1) {
      state = artifactStackReducer(state, { type: "open", ref: web(`n${i}`) });
    }
    expect(state.stack).toHaveLength(ARTIFACT_STACK_LIMIT);
    expect(state.stack[0]?.id).toBe("n3");
    expect(topArtifact(state)?.id).toBe(`n${ARTIFACT_STACK_LIMIT + 2}`);
  });
});
