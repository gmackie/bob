import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { AppShell } from "../app-shell";

describe("@gmacko/app-shell AppShell layout", () => {
  it("renders all 3 slots when provided", () => {
    const { container } = render(
      <AppShell sidebar={<div>Sidebar</div>} header={<div>Header</div>}>
        <div>Content</div>
      </AppShell>,
    );
    expect(container.querySelector("[data-app-shell-sidebar]")).not.toBeNull();
    expect(container.querySelector("[data-app-shell-header]")).not.toBeNull();
    expect(container.querySelector("[data-app-shell-content]")).not.toBeNull();
    // Children render
    expect(container.textContent).toContain("Sidebar");
    expect(container.textContent).toContain("Header");
    expect(container.textContent).toContain("Content");
  });

  it("renders only content when sidebar + header omitted", () => {
    const { container } = render(
      <AppShell>
        <div>Just content</div>
      </AppShell>,
    );
    expect(container.querySelector("[data-app-shell-sidebar]")).toBeNull();
    expect(container.querySelector("[data-app-shell-header]")).toBeNull();
    expect(container.querySelector("[data-app-shell-content]")).not.toBeNull();
    expect(container.textContent).toContain("Just content");
  });
});
