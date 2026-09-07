"use client";

import { useState } from "react";

import { Button } from "@gmacko/core/ui/button";

export function LoginForm({ localAccountAuth = false }: { localAccountAuth?: boolean }) {
  if (localAccountAuth) return <LocalLoginForm />;
  return <HostedLoginForm />;
}

function HostedLoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoEmail, setSsoEmail] = useState("");

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

  const signInWithSSO = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Better-auth resolves the registered IdP from the email domain.
      const res = await fetch("/api/auth/sign-in/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ssoEmail, callbackURL: "/settings" }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text.includes("provider")
            ? "No SSO provider is registered for that email domain."
            : text || `SSO sign-in failed (${res.status})`,
        );
      }

      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        throw new Error("SSO sign-in failed: missing redirect URL");
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO sign-in failed");
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

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          organization SSO
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={signInWithSSO} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={ssoEmail}
          onChange={(e) => setSsoEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Work email for SSO"
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-cyan-400/60 focus:outline-none"
        />
        <Button
          type="submit"
          disabled={loading || !ssoEmail}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-medium text-foreground transition hover:bg-secondary/70 active:translate-y-[1px] disabled:opacity-50"
        >
          Continue with SSO
        </Button>
      </form>
    </div>
  );
}


function LocalLoginForm() {
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/auth/${creating ? "sign-up" : "sign-in"}/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), ...(creating ? { name: form.get("name") } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result === "object" && result !== null && "message" in result && typeof result.message === "string" ? result.message : "Unable to sign in");
      window.location.href = "/settings";
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to sign in"); setLoading(false); }
  }
  return <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-border bg-secondary p-7">
    <h2 className="text-2xl font-semibold">{creating ? "Create a local account" : "Sign in to this device"}</h2>
    <p className="text-sm text-muted-foreground">This account and its data stay on this device. It is separate from your hosted Bob account.</p>
    {creating && <label>Name<input className="mt-1 w-full rounded border p-2" name="name" required autoComplete="name" /></label>}
    <label>Email<input className="mt-1 w-full rounded border p-2" name="email" type="email" required autoComplete="username" /></label>
    <label>Password<input className="mt-1 w-full rounded border p-2" name="password" type="password" required minLength={8} autoComplete={creating ? "new-password" : "current-password"} /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={loading} type="submit">{loading ? "Please wait…" : creating ? "Create account" : "Sign in"}</Button>
    <Button disabled={loading} type="button" variant="outline" onClick={() => { setCreating(!creating); setError(null); }}>{creating ? "Use an existing local account" : "Create a local account"}</Button>
  </form>;
}
