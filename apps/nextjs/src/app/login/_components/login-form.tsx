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
    <div className="mx-auto w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600">
        Sign in with GitHub to access Bob.
      </p>

      <div className="mt-6">
        <Button
          type="button"
          onClick={signInWithGitHub}
          disabled={loading}
          className="w-full"
        >
          {loading ? "Redirecting..." : "Continue with GitHub"}
        </Button>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
