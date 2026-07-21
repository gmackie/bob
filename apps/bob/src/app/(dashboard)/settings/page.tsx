"use client";

import { useSearchParams } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { CollapsibleSection } from "./_components/collapsible-section";
import { ApiKeysSection } from "./_components/api-keys";
import { CookieJar } from "./_components/cookie-jar";
import { ConfigFilesSection } from "./_components/config-files";
import { DeviceHeartbeatsSection } from "./_components/device-heartbeats";
import { GitProvidersSection } from "./_components/git-providers";
import { IntegrationsSection } from "./_components/integrations";
import { PreferencesSection } from "./_components/preferences";
import { WebhooksSection } from "./_components/webhooks";
import { WorkspaceAgentsSection } from "./_components/workspace-agents";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const openSection = searchParams?.get("section") ?? "";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Settings" }]} className="mb-4" />

      <header className="mb-8 rounded-[2rem] border border-border bg-card px-8 py-8">
        <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Configuration
        </div>
        <h1 className="mt-3 font-display text-4xl font-semibold text-foreground">Settings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Manage preferences, Git provider connections, config files, and API
          keys.
        </p>
      </header>

      <div className="space-y-8">
        <CollapsibleSection title="Preferences" sectionId="preferences" defaultOpen>
          <PreferencesSection />
        </CollapsibleSection>
        <CollapsibleSection title="Workspace Agents" sectionId="workspace-agents" defaultOpen={false} forceOpen={openSection === "workspace-agents"}>
          <WorkspaceAgentsSection />
        </CollapsibleSection>
        <CollapsibleSection title="Integrations" sectionId="integrations" defaultOpen forceOpen={openSection === "integrations"}>
          <IntegrationsSection />
        </CollapsibleSection>
        <CollapsibleSection title="Git Providers" sectionId="git-providers" defaultOpen>
          <GitProvidersSection />
        </CollapsibleSection>
        <CollapsibleSection title="Config Files (MCP / Skills / Agents)" sectionId="config-files" defaultOpen={false}>
          <ConfigFilesSection />
        </CollapsibleSection>
        <CollapsibleSection title="API Keys" sectionId="api-keys" defaultOpen={false} forceOpen={openSection === "api-keys"}>
          <ApiKeysSection />
        </CollapsibleSection>
        <CollapsibleSection title="Devices" sectionId="devices" defaultOpen forceOpen={openSection === "devices"}>
          <DeviceHeartbeatsSection />
        </CollapsibleSection>
        <CollapsibleSection title="Cookie Jar" sectionId="cookie-jar" defaultOpen={false} forceOpen={openSection === "cookie-jar"}>
          <CookieJar />
        </CollapsibleSection>
        <CollapsibleSection title="Webhooks" sectionId="webhooks" defaultOpen={false} forceOpen={openSection === "webhooks"}>
          <WebhooksSection />
        </CollapsibleSection>
      </div>
    </div>
  );
}
