"use client";

import { useState } from "react";

import { Button } from "@bob/ui/button";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGitHub = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: "/settings" }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Sign-in failed (${res.status})`);
      }

      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        throw new Error("Sign-in failed: missing redirect URL");
      }

      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-[26px] border border-border bg-secondary p-7 shadow-[0_18px_60px_rgba(0,0,0,.55)] backdrop-blur-md">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
      <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
        Sign in
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Sign in with GitHub to access blder.bot.
      </p>

      <div className="mt-6">
        <Button
          type="button"
          onClick={signInWithGitHub}
          disabled={loading}
          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-gradient-to-r from-cyan-400/95 to-blue-400/90 px-4 py-3 text-sm font-medium text-slate-950 shadow-[0_14px_38px_rgba(56,189,248,.35)] transition hover:from-cyan-300 hover:to-blue-300 active:translate-y-[1px]"
        >
          {loading ? "Redirecting..." : "Continue with GitHub"}
        </Button>
        {error ? (
          <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
