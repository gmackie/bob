"use client";

import { useEffect, useState } from "react";

// ooda.gmac.io is a public alias of the OODA worker. Auth is SSO via a
// .blder.bot-scoped cookie, which a browser on gmac.io can't send — so chat,
// Remember, and projects can't run here. Rather than let people hit a bare
// "Not authenticated", show a thin bar pointing them at ooda.blder.bot (same
// path) for anything that needs a login. Renders nothing anywhere else.
export function PublicAliasNotice() {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname === "ooda.gmac.io") {
      setHref(
        `https://ooda.blder.bot${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  if (!href) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 border-b border-[#2A2825] bg-[#1A1915] px-4 py-1.5 text-center text-xs text-[#8A8580]">
      <span>Public view &mdash; log in on</span>
      <a
        href={href}
        className="font-medium text-[#D4A04A] hover:underline"
      >
        ooda.blder.bot
      </a>
      <span>to chat, Remember, or start a project.</span>
    </div>
  );
}
