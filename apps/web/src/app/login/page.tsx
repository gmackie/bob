"use client";

import { useRouter } from "next/navigation";
import { LoginForm } from "@gmacko/app-shell";

export default function LoginPage() {
  const router = useRouter();

  return (
    <main style={{ maxWidth: "400px", margin: "4rem auto", padding: "1rem" }}>
      <h1>Sign in</h1>
      <LoginForm
        githubAuthHref="/api/auth/sign-in/social?provider=github"
        deviceFlowHref="/login/device"
        onSubmit={async ({ email, password }) => {
          const res = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (res.ok) {
            router.push("/dashboard");
          } else {
            console.error("Sign-in failed:", await res.text());
            // Toast not used here yet — caller harness wires it.
          }
        }}
      />
    </main>
  );
}
