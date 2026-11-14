import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ITEM_STATES, STATE_EDGES, STATE_PRESENTATION, type ItemState } from "@bob/sdlc-view";
import { StateGraph } from "./state-graph";

const counts = Object.fromEntries(ITEM_STATES.map((s, i) => [s, i])) as Record<ItemState, number>;
const nodeOf = (html: string, state: ItemState) => html.match(new RegExp(`<g[^>]*data-state="${state}"[^>]*>.*?</g>`))?.[0] ?? "";

describe("StateGraph", () => {
  it("draws every state with its count as a keyboard-selectable button", () => {
    const html = renderToStaticMarkup(<StateGraph counts={counts} />);
    ITEM_STATES.forEach((state, i) => {
      expect(html).toContain(`aria-label="${STATE_PRESENTATION[state].label}: ${i}"`);
      expect(nodeOf(html, state)).toMatch(/role="button"[^>]*tabindex="0"/);
    });
  });

  it("draws exactly the coordinator's transitions, with back edges dashed", () => {
    const html = renderToStaticMarkup(<StateGraph counts={counts} />);
    const edges = [...html.matchAll(/<path data-edge="([^"]+)"[^>]*>/g)];
    expect(edges.map((m) => m[1])).toEqual(STATE_EDGES.map((e) => `${e.from}-&gt;${e.to}`));
    edges.forEach((m, i) => expect(m[0].includes("stroke-dasharray")).toBe(Boolean(STATE_EDGES[i]!.loop)));
  });

  it("marks stalled validating with the attention colour, and an ordinary state with its owner colour", () => {
    const html = renderToStaticMarkup(<StateGraph counts={counts} />);
    expect(nodeOf(html, "validating")).toContain('data-attention="stalled"');
    expect(nodeOf(html, "validating")).toContain("stroke-amber-500");
    expect(nodeOf(html, "running")).not.toContain("amber");
    expect(nodeOf(html, "running")).toContain("stroke-sky-500");
  });

  it("shows the selected state as pressed and dims states nothing writes yet", () => {
    const html = renderToStaticMarkup(<StateGraph counts={counts} selected="running" />);
    expect(nodeOf(html, "running")).toContain('aria-pressed="true"');
    expect(nodeOf(html, "ready")).toContain('aria-pressed="false"');
    expect(nodeOf(html, "review")).toContain("opacity-50");
    expect(nodeOf(html, "running")).not.toContain("opacity-50");
  });
});
