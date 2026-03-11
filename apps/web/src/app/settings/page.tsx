import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { ApiKeysSection } from "./_components/api-keys";
import { ConfigFilesSection } from "./_components/config-files";
import { GitProvidersSection } from "./_components/git-providers";
import { PreferencesSection } from "./_components/preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-8 text-3xl font-bold">Settings</h1>

      <div className="space-y-8">
        <PreferencesSection />
        <GitProvidersSection />
        <ConfigFilesSection />
        <ApiKeysSection />
      </div>
    </main>
  );
}
