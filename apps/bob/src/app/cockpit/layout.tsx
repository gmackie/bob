import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

/**
 * Chrome-less shell for the cockpit wall: no sidebar, black to the edges,
 * same auth gate as the dashboard. Kiosk = just open /cockpit fullscreen.
 */
export default async function CockpitLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <div className="min-h-screen bg-[#05070c] text-white">{children}</div>;
}
