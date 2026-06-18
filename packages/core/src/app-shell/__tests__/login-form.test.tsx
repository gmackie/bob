import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LoginForm } from "../login-form";

describe("@gmacko/app-shell LoginForm", () => {
  it("renders email + password fields, submit button, GitHub link, and device-flow link", () => {
    render(<LoginForm />);
    // Email + password inputs
    expect(screen.getByLabelText(/email/i)).not.toBeNull();
    expect(screen.getByLabelText(/password/i)).not.toBeNull();
    // Sign-in submit
    expect(
      screen.getByRole("button", { name: /^sign in$/i }),
    ).not.toBeNull();
    // GitHub OAuth link
    const github = screen.getByRole("button", { name: /github/i });
    expect(github).not.toBeNull();
    expect(github.getAttribute("href")).toBe("/api/auth/github");
    // Device-flow CTA
    const deviceLink = screen.getByText(/i have a code/i);
    expect(deviceLink).not.toBeNull();
    expect(deviceLink.getAttribute("href")).toBe("/login/device");
  });

  it("submitting calls onSubmit with form values", () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "hunter2",
    });
  });
});
