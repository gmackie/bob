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
  kanbangerWebOrigin: "https://tasks.gmac.io",
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

  it("builds a workspace-scoped KanBanger link", () => {
    // KanBanger routes everything under /dashboard/:workspaceSlug. Reading its
    // real routes rather than assuming a flat /issues/:id is what stopped this
    // shipping as 404s.
    const link = buildExternalLink(
      { target: "kanbanger.tasks", workspaceSlug: "gmackie" },
      config,
    );

    expect(link?.webUrl).toBe("https://tasks.gmac.io/dashboard/gmackie/tasks/all");
  });

  it("percent-encodes a workspace slug, so it cannot forge extra path segments", () => {
    const link = buildExternalLink(
      { target: "kanbanger.triage", workspaceSlug: "a/../b" },
      config,
    );

    expect(link?.webUrl).not.toContain("/../");
  });

  it("returns null when a workspace-scoped target has no workspace", () => {
    // Without a workspace the URL lands on a 404; better to render nothing.
    expect(buildExternalLink({ target: "kanbanger.tasks" }, config)).toBeNull();
  });

  it("returns null when the target needs an id and none was given", () => {
    expect(buildExternalLink({ target: "forgegraph.node" }, config)).toBeNull();
  });

  it("returns null when that app is not configured, rather than a broken link", () => {
    const link = buildExternalLink(
      { target: "kanbanger.tasks", workspaceSlug: "gmackie" },
      { ...config, kanbangerWebOrigin: "", kanbangerScheme: "" },
    );

    expect(link).toBeNull();
  });
});

describe("linkAffordance", () => {
  it("keeps KanBanger tasks inside Bob, offering the app only as a secondary", () => {
    // Bob renders task detail. Sending someone out to read what is already on
    // screen is a regression dressed as an integration.
    const affordance = linkAffordance("kanbanger.tasks");

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
