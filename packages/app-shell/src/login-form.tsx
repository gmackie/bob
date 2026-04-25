"use client";

import { useState } from "react";

export interface LoginFormProps {
  /** Called when user submits email + password. */
  readonly onSubmit?: (input: { email: string; password: string }) => void;
  /** OAuth provider link (default GitHub). Defaults to "/api/auth/github". */
  readonly githubAuthHref?: string;
  /** Link to device-flow entry page for mobile/desktop login. Default "/login/device". */
  readonly deviceFlowHref?: string;
}

/**
 * Pure presentational login form. No auth logic — caller wires `onSubmit` for
 * credential auth flows; OAuth + device flow are external links.
 */
export function LoginForm({
  onSubmit,
  githubAuthHref = "/api/auth/github",
  deviceFlowHref = "/login/device",
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Login">
      <label>
        Email
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit">Sign in</button>
      <a href={githubAuthHref} role="button">
        Sign in with GitHub
      </a>
      <a href={deviceFlowHref}>I have a code</a>
    </form>
  );
}
