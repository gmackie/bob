import { createContext, createElement, useCallback, useContext, useMemo, useReducer } from "react";
import type { ReactNode } from "react";

import {
  EMPTY_ARTIFACT_STACK,
  artifactStackReducer,
  topArtifact,
} from "./artifact-stack-model";
import type { ArtifactRef } from "./types";

export interface OpenArtifactOptions {
  /** Swap the current top artifact instead of pushing on top of it. */
  replace?: boolean;
}

export interface ArtifactStackApi {
  stack: ArtifactRef[];
  top: ArtifactRef | null;
  open: (ref: ArtifactRef, opts?: OpenArtifactOptions) => void;
  back: () => void;
  close: () => void;
  update: (id: string, patch: Partial<ArtifactRef>) => void;
}

const noop = (): void => undefined;

/**
 * Returned by `useArtifactStack()` when no provider is mounted (e.g. phone
 * screens that have no artifact pane). Calls are silently ignored and the
 * stack is always empty, so callers never need to guard on provider presence.
 */
export const NOOP_ARTIFACT_STACK: ArtifactStackApi = {
  stack: [],
  top: null,
  open: noop,
  back: noop,
  close: noop,
  update: noop,
};

const ArtifactStackContext = createContext<ArtifactStackApi | null>(null);

/**
 * Mount at the tablet layout level (above the conversation routes) so the
 * document stack persists across conversation switches.
 */
export function ArtifactStackProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(artifactStackReducer, EMPTY_ARTIFACT_STACK);

  const open = useCallback(
    (ref: ArtifactRef, opts?: OpenArtifactOptions) =>
      dispatch({ type: "open", ref, replace: opts?.replace }),
    [],
  );
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const update = useCallback(
    (id: string, patch: Partial<ArtifactRef>) => dispatch({ type: "update", id, patch }),
    [],
  );

  const value = useMemo<ArtifactStackApi>(
    () => ({ stack: state.stack, top: topArtifact(state), open, back, close, update }),
    [state, open, back, close, update],
  );

  return createElement(ArtifactStackContext.Provider, { value }, children);
}

/**
 * Access the artifact stack. Safe to call outside an `ArtifactStackProvider`:
 * it returns `NOOP_ARTIFACT_STACK` instead of throwing.
 */
export function useArtifactStack(): ArtifactStackApi {
  return useContext(ArtifactStackContext) ?? NOOP_ARTIFACT_STACK;
}
