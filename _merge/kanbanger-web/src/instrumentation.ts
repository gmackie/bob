export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

let sentryRuntime: typeof import("@sentry/node") | null = null;

const loadRuntimeSentry = async () => {
  if (sentryRuntime !== null) {
    return sentryRuntime;
  }

  try {
    sentryRuntime = await import("@sentry/node");
    return sentryRuntime;
  } catch {
    sentryRuntime = null;
    return null;
  }
};

export const onRequestError = async (
  error: Error,
  request: Request,
  context: { routerKind: string; routePath: string; routeType: string }
) => {
  const Sentry = await loadRuntimeSentry();
  if (!Sentry) {
    return;
  }

  Sentry.captureException(error, {
    extra: {
      url: request.url,
      method: request.method,
      ...context,
    },
  });
};
