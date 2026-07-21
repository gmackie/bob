import { describe, expect, it } from "vitest";
import { SessionAdmission } from "./session-admission.js";

describe("SessionAdmission", () => {
  it("reserves capacity synchronously and rejects duplicate or excess delivery", () => {
    const admission = new SessionAdmission(2);

    expect(admission.reserve("one")).toBe(true);
    expect(admission.reserve("one")).toBe(false);
    expect(admission.reserve("two")).toBe(true);
    expect(admission.reserve("three")).toBe(false);
    expect(admission.size).toBe(2);

    admission.release("one");
    expect(admission.reserve("three")).toBe(true);
  });
});
