import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Tappable } from "../../../input/components";
import { Parent, Shape, Transform } from "../../../renderer/components";
import { Exiting, system } from "../../../world/ecs/define";
import { indexOf } from "../../../world/ecs/entities";
import { Box, popup } from "../../components";
import { defineComponent } from "../../jsx/component";
import { FRAGMENT, flatten, textNode } from "../../jsx/flatten";
import { ELEMENT_OWNED, extrasOf, identityOf, isFlagsOf } from "../../jsx/reconcile";
import { Fragment, jsx, jsxDEV, jsxs } from "../../jsx/runtime";
import {
  type ExtrasApp,
  Flag,
  leaveMs,
  Mark,
  mountScreen,
  settle,
  startExtrasApp,
  TAGS
} from "../extras-app";

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

// ─── popup of a component that keeps local state ──────────────

describe("popup", () => {
  it("names the outcomes of a component that also keeps local state", () => {
    const Settings = defineComponent("Settings", {
      local: { tab: "audio" },
      outcomes: { close: {}, reset: {} },
      view: (props: { volume: number }, local) =>
        jsx("column", { children: `${local.tab}:${props.volume}` })
    });

    expect(popup(Settings, { volume: 3 })).toEqual({
      kind: "popup",
      payload: { component: "Settings", props: { volume: 3 } },
      answers: ["close", "reset"]
    });
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

    expect(isFlagsOf(node, { pressed: true, hover: false, focus: false, covered: false })).toEqual({
      pressed: true,
      hover: false,
      focus: false,
      disabled: false,
      active: true,
      selected: false,
      covered: false
    });
  });

  it("takes hover from the pointer and covered from the root, never from the markup", () => {
    const node = {
      type: "button",
      props: { state: { disabled: true, hover: false, covered: false } },
      children: []
    };

    expect(
      isFlagsOf(node, { pressed: false, hover: true, focus: true, covered: true })
    ).toMatchObject({
      disabled: true,
      hover: true,
      focus: true,
      covered: true
    });
  });
});

// ─── the components prop: what the element keeps for itself ──

describe("extrasOf", () => {
  it("drops the values the element owns and keeps the last value of one type", () => {
    const node = {
      type: "button",
      props: { components: [Mark({ level: 1 }), Transform({ x: 10 }), Flag(), Mark({ level: 4 })] },
      children: []
    };

    expect([...extrasOf({ node }).values()]).toEqual([Mark({ level: 4 }), Flag()]);
  });

  it("is empty when the node names no components", () => {
    expect(extrasOf({ node: { type: "row", props: {}, children: [] } }).size).toBe(0);
  });

  it("owns every component the reconcile, the exit and the pointer write on an element", () => {
    expect([...ELEMENT_OWNED].toSorted()).toEqual(
      [
        "Transform",
        "Box",
        "Layer",
        "Order",
        "Parent",
        "Sprite",
        "NineSlice",
        "Shape",
        "Text",
        "Tappable",
        "Touchable",
        "LocalWrite",
        "Scroll",
        "Escapable",
        "Exiting",
        "Pressed",
        "PointerOver"
      ].toSorted()
    );
  });
});

// ─── the components prop on a real world ──────────────────────

/**
 * The entity of a keyed element of the running app.
 *
 * @param app - The running app.
 * @param key - The element key.
 * @returns The entity.
 */
function find(app: ExtrasApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? -1;
}

/**
 * Taps a local-state button and runs the frames of the re-render.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 * @param frames - How many frames to step.
 */
function tapAndStep(app: ExtrasApp, key: string, frames = 2): void {
  app.input.tap(find(app, key));

  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}

/**
 * Records, frame by frame, which entities the world marked changed for `Mark`.
 *
 * @param app - The running app.
 * @returns The list the sync system fills, one entry per frame.
 */
function watchMark(app: ExtrasApp): number[][] {
  const seen: number[][] = [];

  app.world.ecs.system(
    system({
      name: "markWatcher",
      phase: "sync",
      query: [],
      run: () => {
        seen.push([...app.world.ecs.changed(Mark)]);
      }
    })
  );

  return seen;
}

/**
 * The payloads of every `ui:component-owned` error logged so far.
 *
 * @param app - The running app.
 * @returns The payloads, in order.
 */
function ownedErrors(app: ExtrasApp): unknown[] {
  return app.log
    .trace()
    .filter(entry => entry.event === "ui:component-owned")
    .map(entry => entry.data);
}

describe("the components prop", () => {
  it("adds the values to the element entity next to its own components", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "markedScreen");

    const entity = find(app, "b");
    const ecs = app.world.ecs;

    expect(ecs.get(entity, Mark)).toEqual({ level: 2 });
    expect(ecs.has(entity, Flag)).toBe(true);
    expect([Tappable, Shape, Box].map(type => ecs.has(entity, type))).toEqual([true, true, true]);
    expect(ownedErrors(app)).toEqual([]);

    await app.stop();
  });

  it("adds the extras before Box, so the Box hook sees them", async () => {
    const app = await startExtrasApp();
    const ecs = app.world.ecs;
    const markSawBox = new Map<number, boolean>();
    const boxSawMark = new Map<number, boolean>();

    ecs.onAdded(Mark, entity => markSawBox.set(entity, ecs.has(entity, Box)));
    ecs.onAdded(Box, entity => boxSawMark.set(entity, ecs.has(entity, Mark)));
    mountScreen(app, "markedScreen");

    const entity = find(app, "b");

    expect(markSawBox.get(entity)).toBe(false);
    expect(boxSawMark.get(entity)).toBe(true);

    await app.stop();
  });

  it("patches a changed field once", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "markedScreen");

    const entity = find(app, "b");
    const seen = watchMark(app);

    tapAndStep(app, "toFive");

    expect(app.world.ecs.get(entity, Mark)).toEqual({ level: 5 });
    expect(seen.flat()).toEqual([entity]);

    await app.stop();
  });

  it("writes nothing when a re-render names the same fields in a new array", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "markedScreen");
    tapAndStep(app, "toFive");

    const entity = find(app, "b");
    const seen = watchMark(app);

    tapAndStep(app, "again");

    expect(seen.flat()).toEqual([]);

    app.world.ecs.set(entity, Mark, { level: 9 });
    app.time.step(16);
    seen.length = 0;
    tapAndStep(app, "again");

    expect(seen.flat()).toEqual([]);
    expect(app.world.ecs.get(entity, Mark)).toEqual({ level: 9 });

    await app.stop();
  });

  it("removes a value that left the list, and every value when the prop is left out", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "markedScreen");

    const entity = find(app, "b");
    const ecs = app.world.ecs;

    tapAndStep(app, "dropMark");

    expect(ecs.has(entity, Mark)).toBe(false);
    expect(ecs.has(entity, Flag)).toBe(true);

    tapAndStep(app, "addMark");

    expect(ecs.get(entity, Mark)).toEqual({ level: 2 });

    tapAndStep(app, "dropAll");

    expect(ecs.has(entity, Flag)).toBe(false);
    expect(ecs.has(entity, Tappable)).toBe(true);

    await app.stop();
  });

  it("drops a value the element owns and logs it once per element and name", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "clashScreen");

    const entity = find(app, "owner");
    const ecs = app.world.ecs;
    const errors = [
      { key: "owner", component: "Transform" },
      { key: "owner", component: "Shape" },
      { key: expect.stringContaining("|row@1|row"), component: "Order" }
    ];

    expect(ownedErrors(app)).toEqual(errors);
    expect(ecs.get(entity, Transform)?.x).not.toBe(10);
    expect(ecs.get(entity, Shape)?.fill).toBe(0x11_11_11);
    expect(ecs.get(entity, Mark)).toEqual({ level: 3 });

    tapAndStep(app, "clashAgain");

    expect(ownedErrors(app)).toEqual(errors);
    expect(ecs.get(entity, Transform)?.x).not.toBe(10);
    expect(ecs.get(entity, Shape)?.fill).toBe(0x11_11_11);

    await app.stop();
  });

  it("patches the extras of a popup the flow shows again", async () => {
    const app = await startExtrasApp();

    expect(app.flow.gate.answer({ intent: "openPopup" })).toBe(true);
    await settle(app);

    const button = find(app, "popupButton");

    expect(app.world.ecs.get(button, Mark)).toEqual({ level: 1 });
    expect(app.input.tap(button)).toBe(true);
    await settle(app);

    expect(app.flow.state().path).toBe("shown");
    expect(app.ui.find("popupButton")).toBe(button);
    expect(app.world.ecs.get(button, Mark)).toEqual({ level: 2 });
    expect(app.world.ecs.has(button, Flag)).toBe(true);
    expect(ownedErrors(app)).toEqual([]);

    await app.stop();
  });

  it("starts clean on a recycled entity index", async () => {
    const app = await startExtrasApp();
    const ecs = app.world.ecs;

    mountScreen(app, "markedScreen");

    const first = find(app, "b");

    tapAndStep(app, "hide", 3);

    expect(app.ui.find("b")).toBeUndefined();
    expect(ecs.has(first, Box)).toBe(false);

    tapAndStep(app, "show");

    const second = find(app, "b");

    expect(second).not.toBe(first);
    expect(indexOf(second)).toBe(indexOf(first));
    expect(ecs.get(second, Mark)).toEqual({ level: 2 });
    expect(ownedErrors(app)).toEqual([]);

    tapAndStep(app, "dropMark");

    expect(ecs.has(second, Mark)).toBe(false);
    expect(ecs.has(second, Flag)).toBe(true);

    await app.stop();
  });

  it("keeps the extras on an exiting element until it despawns", async () => {
    const app = await startExtrasApp();
    const ecs = app.world.ecs;

    mountScreen(app, "leavingScreen");

    const entity = find(app, "leaver");

    tapAndStep(app, "leave");

    expect(ecs.has(entity, Exiting)).toBe(true);
    expect(ecs.get(entity, Mark)).toEqual({ level: 7 });

    for (let elapsed = 0; elapsed < leaveMs * 2; elapsed += 16) app.time.step(16);

    expect(ecs.has(entity, Mark)).toBe(false);
    expect(ecs.has(entity, Box)).toBe(false);

    await app.stop();
  });
});

describe("the components prop on every tag", () => {
  let app: ExtrasApp;

  beforeAll(async () => {
    app = await startExtrasApp();
    mountScreen(app, "everyTag");
  });

  afterAll(async () => {
    await app.stop();
  });

  it.each(TAGS)("mounts Mark on a %s", tagName => {
    expect(app.world.ecs.get(find(app, `tag-${tagName}`), Mark)).toEqual({ level: 1 });
  });

  it("puts the extras on the scroll container, not on its content", () => {
    const scroll = find(app, "tag-scroll");
    const content = [...app.world.ecs.query(Parent)]
      .filter(([, parent]) => parent.entity === scroll)
      .map(([entity]) => entity);

    expect(content).toHaveLength(1);
    expect(app.world.ecs.has(content[0] ?? -1, Mark)).toBe(false);
  });
});
