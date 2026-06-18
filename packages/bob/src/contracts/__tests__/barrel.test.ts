import { describe, expect, it } from "vitest";

import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "@gmacko/bob/contracts";

describe("@gmacko/bob/contracts barrel", () => {
  it("exports BobNotFoundError as a tagged error class", () => {
    const err = new BobNotFoundError({ entity: "workItem", id: "abc" });
    expect(err._tag).toBe("BobNotFoundError");
  });

  it("exports BobForbiddenError as a tagged error class", () => {
    const err = new BobForbiddenError({ message: "no access" });
    expect(err._tag).toBe("BobForbiddenError");
  });

  it("exports BobConflictError as a tagged error class", () => {
    const err = new BobConflictError({ message: "duplicate slug" });
    expect(err._tag).toBe("BobConflictError");
  });
});
