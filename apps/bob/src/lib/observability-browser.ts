"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import {
  buildIdentityProperties,
  type TenantIdentity,
  type UserIdentity,
} from "@bob/observability/identity";
import { resolveObservabilityConfig } from "@bob/observability/config";

let initialized = false;

export function initBrowserObservability(): void {
  if (initialized || typeof window === "undefined") return;

  const config = resolveObservabilityConfig({
    serviceName: "bob-web",
    env: {
      POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      FG_STAGE: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
      BOB_TENANT_ID: process.env.NEXT_PUBLIC_BOB_TENANT_ID,
    },
  });

  if (config.posthog.enabled && config.posthog.apiKey) {
    posthog.init(config.posthog.apiKey, {
      api_host: config.posthog.host,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
    });
    initialized = true;
  }
}

export function identifyBrowserUser(
  user: UserIdentity,
  tenant?: TenantIdentity,
): void {
  if (!initialized) return;

  posthog.identify(user.userId, {
    email: user.email,
    name: user.name,
    ...buildIdentityProperties({ user, tenant }),
  });

  if (tenant?.tenantId) {
    posthog.group("tenant", tenant.tenantId, {
      tenant_slug: tenant.tenantSlug,
      workspace_id: tenant.workspaceId,
    });
  }
}

export function trackBrowserEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

interface ObservabilityIdentityProps {
  user?: UserIdentity;
  tenant?: TenantIdentity;
}

export function ObservabilityIdentity({
  user,
  tenant,
}: ObservabilityIdentityProps) {
  useEffect(() => {
    initBrowserObservability();
    if (user) {
      identifyBrowserUser(user, tenant);
    }
  }, [user, tenant]);

  return null;
}
