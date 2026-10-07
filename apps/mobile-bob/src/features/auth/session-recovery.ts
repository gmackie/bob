export type SessionGatePhase =
  | "loading"
  | "authenticated"
  | "recovering"
  | "signed-out";

export interface SessionGateState {
  sessionPresent: boolean;
  isPending: boolean;
  onboardingPending: boolean;
  errorPresent: boolean;
  errorStatus: number | null;
}

export function getSessionGatePhase(state: SessionGateState): SessionGatePhase {
  if (state.onboardingPending) return "loading";
  if (state.sessionPresent) return "authenticated";
  if (state.isPending) return "loading";
  if (
    state.errorPresent &&
    state.errorStatus !== 401 &&
    state.errorStatus !== 403
  ) {
    return "recovering";
  }
  return "signed-out";
}

interface SessionRecoveryDependencies {
  retry: () => void;
  afterDelay: (retry: () => void) => () => void;
  onForeground: (retry: () => void) => () => void;
  onConnectionRestored: (retry: () => void) => () => void;
}

/** Each failed lookup schedules one retry; a new error schedules the next. */
export function startSessionRecovery(
  dependencies: SessionRecoveryDependencies,
) {
  let active = true;
  const retry = () => {
    if (!active) return;
    active = false;
    dependencies.retry();
  };
  const cancelDelay = dependencies.afterDelay(retry);
  const cancelForeground = dependencies.onForeground(retry);
  const cancelConnection = dependencies.onConnectionRestored(retry);

  return () => {
    active = false;
    cancelDelay();
    cancelForeground();
    cancelConnection();
  };
}
