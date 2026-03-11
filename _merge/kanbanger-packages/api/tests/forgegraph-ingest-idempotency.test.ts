import { describe, expect, it } from "vitest";
import { isIdempotentForgeRunUpdate } from "../src/routers/forge-run";

describe("ForgeGraph ingest idempotency", () => {
  it("returns true for identical event payloads", () => {
    const result = isIdempotentForgeRunUpdate(
      {
        status: "tests_finished",
        testStatus: "pass",
        artifactRefs: [{ type: "junit", url: "https://example.com/a.xml" }],
      },
      {
        eventType: "tests_finished",
        testStatus: "pass",
        artifactRefs: [{ type: "junit", url: "https://example.com/a.xml" }],
      }
    );

    expect(result).toBe(true);
  });

  it("returns false when status changes", () => {
    const result = isIdempotentForgeRunUpdate(
      {
        status: "tests_started",
        testStatus: null,
        artifactRefs: [],
      },
      {
        eventType: "tests_finished",
      }
    );

    expect(result).toBe(false);
  });

  it("returns false when artifact refs change", () => {
    const result = isIdempotentForgeRunUpdate(
      {
        status: "tests_finished",
        testStatus: "pass",
        artifactRefs: [{ type: "junit", url: "https://example.com/a.xml" }],
      },
      {
        eventType: "tests_finished",
        testStatus: "pass",
        artifactRefs: [{ type: "junit", url: "https://example.com/b.xml" }],
      }
    );

    expect(result).toBe(false);
  });
});
