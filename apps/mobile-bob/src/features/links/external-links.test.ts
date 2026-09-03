/**
 * Deep links out of Bob to the sibling apps.
 *
 * The rule that matters: Bob is where you review, so a link OUT is an escape
 * hatch for what Bob cannot show — not the default path. Most Kanbanger issue
 * detail already renders inside Bob, so sending someone to another app to read
 * something they are already looking at is a regression, not a feature.
 *
 * ForgeGraph is the opposite case: deploys, nodes, CI and alerts have no Bob
 * equivalent, so those links are primary.
 *
 * Every link prefers the native app scheme and falls back to https, because a
 * teammate without the app installed still has to be able to follow a link.
 */
import { describe, expect, it } from "vitest";

import { buildExternalLink, linkAffordance } from "./external-links";

const config = {
  forgegraphScheme: "forgegraph",
  forgegraphWebOrigin: "https://forgegraf.com",
  kanbangerScheme: "kanbanger",
  kanbangerWebOrigin: "https://kanbanger.app",
};

describe("buildExternalLink", () => {
  it("builds a ForgeGraph app deep link with an https fallback", () => {
    const link = buildExternalLink({ target: "forgegraph.app", id: "pfapp_bob" }, config);

    expect(link?.appUrl).toBe("forgegraph://apps/pfapp_bob");
    expect(link?.webUrl).toBe("https://forgegraf.com/apps/pfapp_bob");
  });

  it("builds ForgeGraph node, CI and alert links", () => {
    expect(buildExternalLink({ target: "forgegraph.node", id: "hetzner-bob" }, config)?.appUrl).toBe(
      "forgegraph://nodes/hetzner-bob",
    );
    expect(buildExternalLink({ target: "forgegraph.ci", id: "1071" }, config)?.appUrl).toBe(
      "forgegraph://ci/1071",
    );
    expect(buildExternalLink({ target: "forgegraph.alerts" }, config)?.appUrl).toBe(
      "forgegraph://alerts",
    );
  });

  it("builds a Kanbanger issue link", () => {
    const link = buildExternalLink({ target: "kanbanger.issue", id: "KAN-14" }, config);

    expect(link?.appUrl).toBe("kanbanger://issues/KAN-14");
    expect(link?.webUrl).toBe("https://kanbanger.app/issues/KAN-14");
  });

  it("percent-encodes an id, so an id with a slash cannot forge a path", () => {
    const link = buildExternalLink({ target: "kanbanger.issue", id: "a/../b" }, config);

    expect(link?.appUrl).toBe("kanbanger://issues/a%2F..%2Fb");
    expect(link?.webUrl).not.toContain("/../");
  });

  it("returns null when the target needs an id and none was given", () => {
    // A link to a detail screen with no id lands on an error page; better to
    // render no affordance at all.
    expect(buildExternalLink({ target: "kanbanger.issue" }, config)).toBeNull();
    expect(buildExternalLink({ target: "forgegraph.node" }, config)).toBeNull();
  });

  it("returns null when that app is not configured, rather than a broken link", () => {
    const link = buildExternalLink(
      { target: "kanbanger.issue", id: "KAN-14" },
      { ...config, kanbangerWebOrigin: "", kanbangerScheme: "" },
    );

    expect(link).toBeNull();
  });
});

describe("linkAffordance", () => {
  it("keeps a Kanbanger issue inside Bob, offering the app only as a secondary", () => {
    // Bob renders issue detail. Sending someone out to read what is already on
    // screen is a regression dressed as an integration.
    const affordance = linkAffordance("kanbanger.issue");

    expect(affordance.primary).toBe("in_app");
    expect(affordance.externalLabel).toBe("Open in KanBanger");
  });

  it("sends deploys and infra straight out, because Bob has no equivalent", () => {
    for (const target of ["forgegraph.app", "forgegraph.node", "forgegraph.ci"] as const) {
      expect(linkAffordance(target).primary).toBe("external");
    }
  });

  it("labels each destination by name, so a person knows where a tap goes", () => {
    expect(linkAffordance("forgegraph.node").externalLabel).toBe("Open in ForgeGraph");
  });
});
