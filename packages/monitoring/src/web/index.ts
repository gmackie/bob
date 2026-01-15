import type { ReactNode } from "react";

import { integrations } from "@bob/config";

export interface SentryWebConfig {
  dsn: string;
  environment?: string;
  debug?: boolean;
  tracesSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  replaysSessionSampleRate?: number;
}

function detectEnvironment(): string {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV === "preview"
      ? "staging"
      : process.env.VERCEL_ENV;
  }
  return process.env.NODE_ENV ?? "development";
}

export async function initSentryWeb(config: SentryWebConfig): Promise<void> {
  if (!integrations.sentry) {
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  const environment = config.environment ?? detectEnvironment();
  const isProduction = environment === "production";

  Sentry.init({
    dsn: config.dsn,
    environment,
    debug: config.debug ?? !isProduction,
    tracesSampleRate: config.tracesSampleRate ?? (isProduction ? 0.1 : 1.0),
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate ?? 1.0,
    replaysSessionSampleRate:
      config.replaysSessionSampleRate ?? (isProduction ? 0.1 : 1.0),
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
  });
}

export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return children;
}

export async function captureException(error: unknown): Promise<void> {
  if (!integrations.sentry) {
    console.error("[Sentry disabled]", error);
    return;
  }
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(error);
}

export async function captureMessage(message: string): Promise<void> {
  if (!integrations.sentry) {
    console.log("[Sentry disabled]", message);
    return;
  }
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureMessage(message);
}
