import { describe, expect, it, vi } from "vitest";

const { getSessionMock, redirectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("~/auth/server", () => ({
  getSession: getSessionMock,
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../(dashboard)/dashboard.css", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("dashboard layout auth", () => {
  it("redirects unauthenticated requests to /login", async () => {
    vi.resetModules();
    getSessionMock.mockResolvedValueOnce(null);

    const module = await import("../(dashboard)/layout");

    await expect(
      module.default({
        children: "workspace",
        params: Promise.resolve({}),
      }),
    ).rejects.toThrow("redirect:/login");

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
