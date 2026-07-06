import { describe, it, expect } from "vitest";

import { parsePrUrl } from "./pr-url.js";

describe("parsePrUrl", () => {
  it("parses a Forgejo/Gitea PR url", () => {
    expect(parsePrUrl("https://git.forgegraf.com/gmackie/gentrellis/pulls/6")).toEqual({
      host: "git.forgegraf.com",
      owner: "gmackie",
      repo: "gentrellis",
      number: 6,
      provider: "gitea",
    });
  });

  it("parses a github.com PR url (pull, singular) as provider github", () => {
    expect(parsePrUrl("https://github.com/acme/widget/pull/42")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widget",
      number: 42,
      provider: "github",
    });
  });

  it("returns null for a non-PR url", () => {
    expect(parsePrUrl("https://git.forgegraf.com/gmackie/gentrellis")).toBeNull();
    expect(parsePrUrl("not a url")).toBeNull();
  });
});
