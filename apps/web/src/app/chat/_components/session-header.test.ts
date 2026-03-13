import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionHeader } from "./session-header";

describe("SessionHeader", () => {
  it("uses Bob Builder copy for linked work-item navigation", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionHeader, {
        title: "MOB-42 execution",
        status: "running",
        agentType: "bob",
        linkedTask: {
          id: "task-123",
          identifier: "MOB-42",
          title: "Ship mobile promotion flow",
          url: "/work-items/task-123",
        },
      }),
    );

    expect(html).toContain("Open work item");
    expect(html).not.toContain("Kanbanger");
  });
});
