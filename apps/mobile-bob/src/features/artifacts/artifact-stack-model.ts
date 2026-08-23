import type { ArtifactRef } from "./types";

export const ARTIFACT_STACK_LIMIT = 12;

export interface ArtifactStackState {
  /** Document stack; the last element is the visible (top) artifact. */
  stack: ArtifactRef[];
}

export type ArtifactStackAction =
  | { type: "open"; ref: ArtifactRef; replace?: boolean }
  | { type: "back" }
  | { type: "close" }
  | { type: "update"; id: string; patch: Partial<ArtifactRef> };

export const EMPTY_ARTIFACT_STACK: ArtifactStackState = { stack: [] };

function capStack(stack: ArtifactRef[]): ArtifactRef[] {
  return stack.length > ARTIFACT_STACK_LIMIT
    ? stack.slice(stack.length - ARTIFACT_STACK_LIMIT)
    : stack;
}

function applyPatch(ref: ArtifactRef, patch: Partial<ArtifactRef>): ArtifactRef {
  // Keep the discriminant intact: a patch that would change `type` is ignored.
  if (patch.type !== undefined && patch.type !== ref.type) return ref;
  const { type: _ignored, ...rest } = patch;
  return { ...ref, ...rest };
}

export function artifactStackReducer(
  state: ArtifactStackState,
  action: ArtifactStackAction,
): ArtifactStackState {
  switch (action.type) {
    case "open": {
      const without = state.stack.filter((item) => item.id !== action.ref.id);
      if (action.replace && without.length > 0 && without.length === state.stack.length) {
        // Replace the current top (only when the incoming ref isn't already stacked).
        return { stack: capStack([...without.slice(0, -1), action.ref]) };
      }
      return { stack: capStack([...without, action.ref]) };
    }
    case "back": {
      if (state.stack.length === 0) return state;
      return { stack: state.stack.slice(0, -1) };
    }
    case "close": {
      if (state.stack.length === 0) return state;
      return EMPTY_ARTIFACT_STACK;
    }
    case "update": {
      const stack = state.stack.map((item) =>
        item.id === action.id ? applyPatch(item, action.patch) : item,
      );
      const changed = stack.some((item, index) => item !== state.stack[index]);
      return changed ? { stack } : state;
    }
  }
}

export function topArtifact(state: ArtifactStackState): ArtifactRef | null {
  return state.stack.length > 0 ? (state.stack[state.stack.length - 1] ?? null) : null;
}
