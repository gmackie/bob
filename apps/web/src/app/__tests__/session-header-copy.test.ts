import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("session header copy", () => {
  it("uses current task-linked wording in the preview and e2e surface", () => {
    const previewSource = readFileSync(
      path.resolve(__dirname, "../(test)/test-components/page.tsx"),
      "utf8",
    );
    const e2eSource = readFileSync(
      path.resolve(__dirname, "../../../e2e/specs/session-header.spec.ts"),
      "utf8",
    );

    expect(previewSource).not.toContain("Issue-managed session");
    expect(previewSource).not.toContain("Open in Kanbanger");
    expect(previewSource).toContain("Task-linked session");
    expect(previewSource).toContain("Open linked task");

    expect(e2eSource).not.toContain("Issue-managed session");
    expect(e2eSource).not.toContain("Open in Kanbanger");
    expect(e2eSource).toContain("Task-linked session");
    expect(e2eSource).toContain("Open linked task");
  });
});
