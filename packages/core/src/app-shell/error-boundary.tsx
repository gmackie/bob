"use client";

import { Component, type ReactNode } from "react";

interface EffectErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: (error: unknown, reset: () => void) => ReactNode;
}

interface EffectErrorBoundaryState {
  readonly error: unknown | null;
}

export class EffectErrorBoundary extends Component<
  EffectErrorBoundaryProps,
  EffectErrorBoundaryState
> {
  state: EffectErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): EffectErrorBoundaryState {
    return { error };
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return <DefaultErrorView error={error} reset={this.reset} />;
  }
}

function DefaultErrorView({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const taggedError = error as {
    _tag?: string;
    message?: string;
    [k: string]: unknown;
  };
  const tag = typeof taggedError._tag === "string" ? taggedError._tag : null;

  return (
    <div role="alert" data-effect-error-boundary>
      {tag !== null ? (
        <>
          <h2 data-error-tag>{tag}</h2>
          <dl data-error-payload>
            {Object.entries(taggedError)
              .filter(
                ([k]) =>
                  k !== "_tag" &&
                  !k.startsWith("_") &&
                  typeof taggedError[k] !== "function",
              )
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
          </dl>
        </>
      ) : (
        <p>{taggedError.message ?? String(error)}</p>
      )}
      <button type="button" onClick={reset}>
        Reset
      </button>
    </div>
  );
}
