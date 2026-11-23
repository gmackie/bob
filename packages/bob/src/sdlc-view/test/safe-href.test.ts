import { describe, expect, it } from "vitest";
import { safeHref } from "../src/index";

describe("safeHref", () => {
  it("keeps http and https URLs", () => {
    expect(safeHref("https://tasks.gmac.io/BOB-75")).toBe("https://tasks.gmac.io/BOB-75");
    expect(safeHref("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });
  it("drops script, data and other schemes, relative URLs and non-strings", () => {
    for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "/relative", "//evil.example/x", "not a url", "", null, undefined, 42]) {
      expect(safeHref(url)).toBeNull();
    }
  });
});
