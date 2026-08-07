"use client";

import { useEffect, useState } from "react";

// On ooda.gmac.io, single-sign-on with ooda.blder.bot: check auth, and if not
// authenticated, bounce once through the blder.bot handoff (which sets a
// matching .gmac.io session cookie). Only if that comes back empty (?sso=none —
// not logged in on blder.bot either) do we show a login notice, so there's no
// redirect loop. Renders nothing on ooda.blder.bot or once authenticated.
type State = "off" | "checking" | "authed" | "needs-login";

export function PublicAliasNotice() {
  const [state, setState] = useState<State>("off");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname !== "ooda.gmac.io") return;

    setState("checking");
    fetch("/api/sso/status", { credentials: "include" })
      .then((r) => r.json() as Promise<{ authed?: boolean }>)
      .then((d) => {
        if (d.authed) {
          setState("authed");
          return;
        }
        // Not authed. If we already tried the handoff (?sso=none), stop and
        // show the notice; otherwise bounce through blder.bot once.
        const tried =
          new URLSearchParams(window.location.search).get("sso") === "none";
        if (tried) {
          setState("needs-login");
          return;
        }
        const back = encodeURIComponent(window.location.href);
        window.location.replace(
          `https://ooda.blder.bot/api/sso/handoff?r=${back}`,
        );
      })
      .catch(() => setState("needs-login"));
  }, []);

  if (state !== "needs-login") return null;

  const loginHref = `https://ooda.blder.bot${
    typeof window !== "undefined" ? window.location.pathname : "/oracle"
  }`;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 border-b border-[#2A2825] bg-[#1A1915] px-4 py-1.5 text-center text-xs text-[#8A8580]">
      <span>Not signed in &mdash; log in on</span>
      <a href={loginHref} className="font-medium text-[#D4A04A] hover:underline">
        ooda.blder.bot
      </a>
      <span>to chat, Remember, or start a project.</span>
    </div>
  );
}
