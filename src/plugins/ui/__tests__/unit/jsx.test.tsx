import { describe, expect, it } from "vitest";
import { defineComponent } from "../../jsx/component";
import { FRAGMENT, flatten, textNode } from "../../jsx/flatten";
import { identityOf, isFlagsOf } from "../../jsx/reconcile";
import { Fragment, jsx, jsxDEV, jsxs } from "../../jsx/runtime";

// ─── The runtime ──────────────────────────────────────────────

describe("jsx runtime", () => {
  it("takes the key as the third argument, never from the props", () => {
    const node = jsx("row", { style: { gap: 8 } }, "tabs");

    expect(node).toEqual({ type: "row", key: "tabs", props: { style: { gap: 8 } }, children: [] });
  });

  it("is the same function as jsxs", () => {
    expect(jsxs).toBe(jsx);
  });

  it("drops the three debug arguments of jsxDEV", () => {
    const node = jsxDEV("row", {}, "tabs", false, { fileName: "hud.tsx" }, undefined);

    expect(node).toEqual({ type: "row", key: "tabs", props: {}, children: [] });
  });

  it("calls a plain function component at build time", () => {
    const Bar = (props: { gap: number }) => jsx("row", { style: { gap: props.gap } });

    expect(jsx(Bar, { gap: 4 })).toEqual({
      type: "row",
      props: { style: { gap: 4 } },
      children: []
    });
  });

  it("turns a defined component into one node the reconcile expands", () => {
    const Panel = defineComponent("Panel", { view: () => jsx("column", {}) });
    const node = jsx(Panel, { volume: 3 }, "p");

    expect(node).toEqual({ type: "Panel", key: "p", props: { volume: 3 }, children: [] });
  });

  it("lifts the children of a fragment into the parent", () => {
    const node = jsx("row", { children: jsx(Fragment, { children: [jsx("text", {})] }) });

    expect(node.children).toEqual([{ type: "text", props: {}, children: [] }]);
  });
});

// ─── flatten ──────────────────────────────────────────────────

describe("flatten", () => {
  it("drops null, undefined and booleans", () => {
    // eslint-disable-next-line unicorn/no-null -- the rule under test is that a null child drops.
    expect(flatten([null, undefined, true, false])).toEqual([]);
  });

  it("turns a string and a number child into text nodes", () => {
    expect(flatten(["a", 2]).map(node => node.props.content)).toEqual(["a", "2"]);
  });

  it("flattens nested arrays", () => {
    expect(flatten([[textNode("a")], [[textNode("b")]]])).toHaveLength(2);
  });

  it("lifts a fragment node", () => {
    expect(flatten({ type: FRAGMENT, props: {}, children: [textNode("a")] })).toHaveLength(1);
  });
});

// ─── defineComponent ──────────────────────────────────────────

describe("defineComponent", () => {
  it("carries the name, the outcomes and the initial local state", () => {
    const Reward = defineComponent("Reward", {
      outcomes: { claim: {} },
      local: { tab: "a" },
      view: () => jsx("panel", {})
    });

    expect(Reward.name).toBe("Reward");
    expect(Object.keys(Reward.outcomes)).toEqual(["claim"]);
    expect(Reward.local).toEqual({ tab: "a" });
  });

  it("leaves outcomes undefined when the component names none", () => {
    expect(defineComponent("Plain", { view: () => jsx("row", {}) }).outcomes).toBeUndefined();
  });
});

// ─── identity and flags ───────────────────────────────────────

describe("identity", () => {
  it("is the parent, the key or type and index, and the type", () => {
    expect(identityOf("0", { type: "row", props: {}, children: [] }, 2)).toBe("0|row@2|row");
    expect(identityOf("0", { type: "row", key: "bar", props: {}, children: [] }, 2)).toBe(
      "0|bar|row"
    );
  });

  it("reads the state prop of the markup plus the pressed flag", () => {
    const node = { type: "button", props: { state: { active: true } }, children: [] };

    expect(isFlagsOf(node, true)).toEqual({
      pressed: true,
      disabled: false,
      active: true,
      selected: false
    });
  });
});
