import { describe, expect, it } from "vitest";

import { outputTail } from "../bob-gateway";

describe("outputTail", () => {
  it("returns the last non-empty plain lines", () => {
    const out = "starting\n\nworking\n\nfatal: boom\n";
    expect(outputTail(out)).toBe("starting | working | fatal: boom");
  });

  it("extracts message/error text from stream-json lines instead of raw JSON", () => {
    const out = [
      '{"type":"system","subtype":"init"}',
      '{"type":"error","message":"Your access token was revoked"}',
    ].join("\n");
    expect(outputTail(out)).toContain("Your access token was revoked");
    expect(outputTail(out)).not.toContain("{");
  });

  it("prefers error over message over result", () => {
    const out = '{"error":"E","message":"M","result":"R"}';
    expect(outputTail(out)).toBe("E");
  });

  it("keeps only the last few lines", () => {
    const out = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const tail = outputTail(out);
    expect(tail).toContain("line19");
    expect(tail).not.toContain("line0 ");
  });

  it("caps the length", () => {
    const out = "x".repeat(2000);
    expect(outputTail(out, 100).length).toBeLessThanOrEqual(101);
  });

  it("returns empty string for empty output", () => {
    expect(outputTail("")).toBe("");
    expect(outputTail("\n\n  \n")).toBe("");
  });
});
