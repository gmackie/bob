import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { CollapsibleSection } from "./_components/collapsible-section";
import { ApiKeysSection } from "./_components/api-keys";
import { CookieJar } from "./_components/cookie-jar";
import { ConfigFilesSection } from "./_components/config-files";
import { GitProvidersSection } from "./_components/git-providers";
import { PreferencesSection } from "./_components/preferences";
import { WebhooksSection } from "./_components/webhooks";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Settings" }]} className="mb-4" />

      <header className="mb-8 rounded-[2rem] border border-border bg-gradient-to-br from-[#0e1628] via-[#13243a] to-[#0d111c] px-8 py-8">
        <div className="text-xs uppercase tracking-[0.28em] text-white/50">
          Configuration
        </div>
        <h1 className="mt-3 font-display text-4xl font-semibold text-white">Settings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
          Manage preferences, Git provider connections, config files, and API
          keys.
        </p>
      </header>

      <div className="space-y-8">
        <CollapsibleSection title="Preferences" defaultOpen>
          <PreferencesSection />
        </CollapsibleSection>
        <CollapsibleSection title="Git Providers" defaultOpen>
          <GitProvidersSection />
        </CollapsibleSection>
        <CollapsibleSection title="Config Files (MCP / Skills / Agents)" defaultOpen={false}>
          <ConfigFilesSection />
        </CollapsibleSection>
        <CollapsibleSection title="API Keys" defaultOpen={false}>
          <ApiKeysSection />
        </CollapsibleSection>
        <CollapsibleSection title="Cookie Jar" defaultOpen={false}>
          <CookieJar />
        </CollapsibleSection>
        <CollapsibleSection title="Webhooks" defaultOpen={false}>
          <WebhooksSection />
        </CollapsibleSection>
      </div>
    </div>
  );
}
