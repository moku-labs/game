import { describe, expectTypeOf, it } from "vitest";
import { defineMotion } from "../../../anim/motion";
import type { Descriptor } from "../../../flow/fx/types";
import { Transform, type TransformValue } from "../../../renderer/components";
import { bind } from "../../../text/components";
import type { TextBind as TextPluginBind } from "../../../text/types";
import { component, tag } from "../../../world/ecs/define";
import type { Entity, Motion, ViewHandle } from "../../../world/types";
import type { BoxValue } from "../../components";
import { popup, uiFor } from "../../components";
import { defineComponent } from "../../jsx/component";
import type {
  ElementComponents,
  IntrinsicElementsFor,
  ScrollRow,
  ScrollRowHeight,
  ScrollRows,
  TextBind,
  UiIntrinsicElements
} from "../../jsx/intrinsics";
import type { DescriptionNode, Finding, UiNode } from "../../jsx/types";
import { defineStyle } from "../../styles/define";
import type { Config, ElementChange, ElementMotion, UiApi } from "../../types";

const Reward = defineComponent("Reward", {
  outcomes: { claim: {} as { orderId: string } },
  view: (props: { gold: number }) => ({
    type: "panel",
    props: { gold: props.gold },
    children: []
  })
});

const Plain = defineComponent("Plain", { view: () => ({ type: "row", props: {}, children: [] }) });

const Settings = defineComponent("Settings", {
  local: { tab: "audio" },
  outcomes: { close: {} as { saved: boolean } },
  view: (props: { volume: number }, local) => ({
    type: "column",
    props: { volume: props.volume, tab: local.tab },
    children: []
  })
});

const Stateless = defineComponent("Stateless", {
  outcomes: { ok: {} },
  view: () => ({ type: "panel", props: {}, children: [] })
});

describe("the ui API", () => {
  it("answers a snapshot, an entity and a list of findings", () => {
    expectTypeOf<UiApi["tree"]>().toEqualTypeOf<() => UiNode>();
    expectTypeOf<UiApi["find"]>().toEqualTypeOf<(key: string) => Entity | undefined>();
    expectTypeOf<UiApi["lint"]>().toEqualTypeOf<() => readonly Finding[]>();
    expectTypeOf<UiApi["fill"]>().toEqualTypeOf<(key: string, value: string) => boolean>();
  });
});

describe("the text field", () => {
  it("shows the value on a snapshot node and takes the look of the caret from the config", () => {
    expectTypeOf<UiNode["value"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Config["textInput"]["caret"]>().toEqualTypeOf<number>();
    expectTypeOf<Config["textInput"]["keyboardMargin"]>().toEqualTypeOf<number>();
  });

  it("takes the input props, with local required", () => {
    const field: UiIntrinsicElements["input"] = {
      local: "name",
      submit: "save",
      maxLength: 16,
      placeholder: "Your name",
      kind: "email",
      textStyle: "body"
    };
    // @ts-expect-error — a field names the local field it writes.
    const unnamed: UiIntrinsicElements["input"] = { submit: "save" };

    expectTypeOf(field.kind).toExtend<"text" | "number" | "email" | undefined>();
    expectTypeOf(unnamed).not.toBeUndefined();
  });

  it("narrows textStyle, placeholder and the nine-slice to the game's keys", () => {
    type Tags = IntrinsicElementsFor<"ui.field", "body" | "digits", "rename.hint">;

    const field: Tags["input"] = {
      local: "name",
      textStyle: "digits",
      placeholder: "Your name",
      style: { nineSlice: "ui.field" }
    };
    // @ts-expect-error — "huge" is not a text style key of this game.
    const wrongStyle: Tags["input"] = { local: "name", textStyle: "huge" };
    // @ts-expect-error — the nine-slice of a field takes the game's asset keys.
    const wrongSlice: Tags["input"] = { local: "name", style: { nineSlice: "ui.pane" } };

    expectTypeOf(field.textStyle).toEqualTypeOf<"body" | "digits" | undefined>();
    expectTypeOf(wrongStyle).not.toBeUndefined();
    expectTypeOf(wrongSlice).not.toBeUndefined();
  });
});

describe("popup", () => {
  it("takes a component with outcomes and answers a descriptor", () => {
    expectTypeOf(popup(Reward, { gold: 5 })).toEqualTypeOf<Descriptor>();
  });

  it("takes a component that keeps local state next to its outcomes", () => {
    expectTypeOf(popup(Settings, { volume: 3 })).toEqualTypeOf<Descriptor>();
    expectTypeOf(Settings.local).toEqualTypeOf<{ tab: string }>();
  });

  it("takes a component with outcomes and no local state", () => {
    expectTypeOf(popup(Stateless, {})).toEqualTypeOf<Descriptor>();
  });

  it("refuses props a stateful component's view does not take", () => {
    // @ts-expect-error — the view takes `volume`, not `loudness`.
    popup(Settings, { loudness: 3 });
    expectTypeOf(Settings.outcomes).toEqualTypeOf<{ close: { saved: boolean } }>();
  });

  it("refuses a component without outcomes", () => {
    // @ts-expect-error — Plain declares no outcomes, so a popup of it can never resolve.
    popup(Plain, {});
    expectTypeOf(Plain.outcomes).toEqualTypeOf<undefined>();
  });

  it("refuses props the component's view does not take", () => {
    // @ts-expect-error — the view takes `gold`, not `silver`.
    popup(Reward, { silver: 5 });
    expectTypeOf(popup(Reward, { gold: 5 }).kind).toEqualTypeOf<string>();
  });
});

describe("defineStyle", () => {
  it("refuses a value outside the vocabulary", () => {
    // @ts-expect-error — `direction` is "row" or "column".
    defineStyle({ direction: "diagonal" });
    expectTypeOf(defineStyle({ direction: "row" }).direction).toEqualTypeOf<"row">();
  });

  it("takes the visual fields of delta 4 and refuses an origin outside its union", () => {
    expectTypeOf(
      defineStyle({ nineSlice: "ui.panel", fit: "contain" }).fit
    ).toEqualTypeOf<"contain">();
    expectTypeOf(
      defineStyle({ is: { hover: { scale: 1.05 } } }).is.hover.scale
    ).toEqualTypeOf<1.05>();
    // @ts-expect-error — `origin` is "center", "top", "topLeft" or a point in fractions.
    defineStyle({ origin: "bottom" });
    // @ts-expect-error — the only fit a style takes is "contain".
    defineStyle({ fit: "cover" });
  });

  it("refuses a field outside the vocabulary", () => {
    // @ts-expect-error — text size comes from the text style key, never from the layout style.
    defineStyle({ fontSize: 24 });
    expectTypeOf(defineStyle({ gap: 8 }).gap).toEqualTypeOf<8>();
  });
});

describe("the delta 6 vocabulary", () => {
  it("takes rotation, zIndex, shape and dash, and a focus variant", () => {
    const plaque = defineStyle({ rotation: -0.026, zIndex: 1, shape: "triangle", dash: 10 });

    expectTypeOf(plaque.shape).toEqualTypeOf<"triangle">();
    expectTypeOf(
      defineStyle({ is: { focus: { scale: 1.1 } } }).is.focus.scale
    ).toEqualTypeOf<1.1>();
    // @ts-expect-error — a shape is "rect" or "triangle".
    defineStyle({ shape: "circle" });
    // @ts-expect-error — the draw order is a number.
    defineStyle({ zIndex: "top" });
  });

  it("gives a button the escape prop, the snapshot the focus flag and the config the ring", () => {
    const kit = uiFor<"ui.coin", "digits", "hud.coins">();
    const close: typeof kit.intrinsics.button = { intent: "close", escape: true };
    // @ts-expect-error — `escape` marks the button, it names nothing.
    const wrongClose: typeof kit.intrinsics.button = { intent: "close", escape: "close" };

    expectTypeOf(close).not.toBeUndefined();
    expectTypeOf(wrongClose).not.toBeUndefined();
    expectTypeOf<UiNode["state"]["focus"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Config["focusRing"]["offset"]>().toEqualTypeOf<number>();
    expectTypeOf<Finding["rule"]>().toExtend<string>();
    expectTypeOf<"z-index-on-root">().toExtend<Finding["rule"]>();
  });
});

describe("uiFor", () => {
  it("narrows the asset and text style props of the intrinsic tags", () => {
    const kit = uiFor<"ui.coin" | "ui.panel", "digits", "hud.coins">();

    expectTypeOf(kit.intrinsics.image.texture).toEqualTypeOf<"ui.coin" | "ui.panel">();
    expectTypeOf(kit.intrinsics.image.fit).toEqualTypeOf<
      "contain" | "cover" | "fill" | undefined
    >();
    // @ts-expect-error — the nine-slice moved into the style (delta 4): a panel has no such prop.
    expectTypeOf(kit.intrinsics.panel.nineSlice).toBeString();
    expectTypeOf(kit.intrinsics.text.style).toEqualTypeOf<
      "digits" | import("../../styles/types").Style<"ui.coin" | "ui.panel"> | undefined
    >();
  });

  it("narrows the nine-slice of a style to the game's asset keys", () => {
    const kit = uiFor<"ui.coin" | "ui.panel", "digits", "hud.coins">();

    expectTypeOf(kit.defineStyle({ nineSlice: "ui.panel" }).nineSlice).toEqualTypeOf<"ui.panel">();
    // @ts-expect-error — "ui.pane" is not an asset key of this game.
    kit.defineStyle({ nineSlice: "ui.pane" });
    // @ts-expect-error — a state variant takes the game's keys too.
    kit.defineStyle({ is: { disabled: { nineSlice: "ui.off" } } });

    const panelStyle: typeof kit.intrinsics.panel.style = { nineSlice: "ui.panel" };
    // @ts-expect-error — the style prop of a tag takes the game's keys.
    const wrongStyle: typeof kit.intrinsics.row.style = { nineSlice: "ui.pane" };

    expectTypeOf(panelStyle).not.toBeUndefined();
    expectTypeOf(wrongStyle).not.toBeUndefined();
  });
});

/** A change.Transform hook that names the rest poses it is handed. */
const sway = (view: ViewHandle<unknown>, previous: TransformValue, next: TransformValue): Motion =>
  next.scale > previous.scale ? view.toRest(Transform, { ms: 240 }) : undefined;

/** A change.Box hook typed through `ElementChange`. */
const slide: ElementChange<BoxValue> = (view, previous, next) =>
  next.y === previous.y ? undefined : view.toRest(Transform, { ms: 200 });

/** A hook that takes a string where `ui` hands a rest pose. */
const wrong = (view: ViewHandle<unknown>, previous: string): Motion =>
  previous === "" ? undefined : view.toRest(Transform);

describe("element motion", () => {
  type Changes = NonNullable<ElementMotion["change"]>;

  it("hands a change.Transform hook the two rest poses, and a change.Box hook the two rects", () => {
    const card: ElementMotion = { change: { Transform: sway, Box: slide } };

    expectTypeOf(card).toExtend<ElementMotion>();
    expectTypeOf<
      Parameters<NonNullable<Changes["Transform"]>>[1]
    >().toEqualTypeOf<TransformValue>();
    expectTypeOf<Parameters<NonNullable<Changes["Box"]>>[2]>().toEqualTypeOf<BoxValue>();
  });

  it("refuses a change.Transform hook that takes something other than a rest pose", () => {
    // @ts-expect-error — `ui` hands a change.Transform hook rest poses, not strings.
    const card: ElementMotion = { change: { Transform: wrong } };

    expectTypeOf(card).not.toBeUndefined();
  });

  it("takes a defineMotion result as the motion prop of a tag, whatever components it names", () => {
    const kit = uiFor<"ui.coin", "digits", "hud.coins">();
    const pop = defineMotion({
      states: { hidden: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } } },
      on: { enter: "hidden", exit: "hidden", change: ["Transform", "Shape"] }
    });

    expectTypeOf(pop).toExtend<ElementMotion>();
    expectTypeOf(pop).toExtend<typeof kit.intrinsics.column.motion>();
  });
});

/** A game's own component and tag, standing in for a filter of `effects`. */
const Mark = component("Mark", { level: 0 });
const Flag = tag("Flag");

describe("the components prop", () => {
  it("takes component and tag values on every tag", () => {
    type Taken = { [Tag in keyof UiIntrinsicElements]: UiIntrinsicElements[Tag]["components"] };

    const extras: ElementComponents = [Mark({ level: 2 }), Flag()];
    const button: UiIntrinsicElements["button"] = { intent: "claim", components: extras };
    const label: UiIntrinsicElements["text"] = { content: "120", components: [Flag()] };

    expectTypeOf<Taken>().toEqualTypeOf<{
      [Tag in keyof UiIntrinsicElements]: ElementComponents | undefined;
    }>();
    expectTypeOf(button.components).toEqualTypeOf<ElementComponents | undefined>();
    expectTypeOf(label.components).toEqualTypeOf<ElementComponents | undefined>();
  });

  it("keeps it on the tags of IntrinsicElementsFor", () => {
    type Tags = IntrinsicElementsFor<"ui.coin", "digits", "hud.coins">;
    type Taken = { [Tag in keyof Tags]: Tags[Tag]["components"] };

    const image: Tags["image"] = {
      texture: "ui.coin",
      components: [Mark({ level: 2 }), Flag()]
    };

    expectTypeOf<Taken>().toEqualTypeOf<{ [Tag in keyof Tags]: ElementComponents | undefined }>();
    expectTypeOf(image.components).toEqualTypeOf<ElementComponents | undefined>();
  });
});

/** A counter component, as the coin pill of a game carries it. */
const Counter = component("Counter", { value: 0 });

/** What `Counter` holds. */
type CounterValue = { value: number };

/**
 * A `change` hook typed with the value of the extra component it rolls.
 *
 * @param view - The handle of the element.
 * @param _previous - The counter before.
 * @param _next - The counter after.
 * @returns The roll home.
 */
function rollCounter(
  view: ViewHandle<unknown>,
  _previous: CounterValue,
  _next: CounterValue
): Motion {
  return view.toRest(Counter, { ms: 200 });
}

describe("the text bind", () => {
  it("is the text plugin's TextBind, made by bind()", () => {
    expectTypeOf<TextBind>().toEqualTypeOf<TextPluginBind>();

    const label: UiIntrinsicElements["text"] = {
      bind: bind(Counter, "value"),
      components: [Counter({ value: 25 })]
    };
    const themed: IntrinsicElementsFor<"ui.coin", "ui.number", "hud.coins">["text"] = {
      style: "ui.number",
      bind: bind(Counter, "value")
    };

    expectTypeOf(label.bind).toEqualTypeOf<TextBind | undefined>();
    expectTypeOf(themed.bind).toEqualTypeOf<TextBind | undefined>();
  });

  it("takes a change hook typed with the value of the extra component", () => {
    const motion: ElementMotion = { change: { Counter: rollCounter } };

    expectTypeOf(motion.change).not.toBeUndefined();
  });
});

/** One item of a shop list. */
type ShopItem = { id: string; price: number };

/**
 * The row of the design snippet, as a description node.
 *
 * @param item - The item the row shows.
 * @returns The row.
 */
function shopRow(item: ShopItem): DescriptionNode {
  return { type: "row", key: item.id, props: { price: item.price }, children: [] };
}

describe("the windowed scroll", () => {
  const items: ShopItem[] = [{ id: "sword", price: 120 }];

  it("takes rows, rowHeight, overscan and row, and still the child form", () => {
    const shop: UiIntrinsicElements["scroll"] = {
      style: { height: 1600 },
      rows: items.length,
      rowHeight: 80,
      overscan: 5,
      row: index => shopRow(items[index] ?? { id: "none", price: 0 })
    };
    const short: UiIntrinsicElements["scroll"] = { axis: "y", children: [] };

    type Windowed = Extract<UiIntrinsicElements["scroll"], { row: ScrollRow }>;

    expectTypeOf<Windowed["rows"]>().toEqualTypeOf<ScrollRows>();
    expectTypeOf<Windowed["rowHeight"]>().toEqualTypeOf<ScrollRowHeight>();
    expectTypeOf<Windowed["row"]>().toEqualTypeOf<ScrollRow>();
    expectTypeOf(shop).not.toBeUndefined();
    expectTypeOf(short).not.toBeUndefined();
  });

  it("keeps both forms through IntrinsicElementsFor", () => {
    type Tags = IntrinsicElementsFor<"ui.list", "body", "shop.title">;

    const shop: Tags["scroll"] = {
      style: { nineSlice: "ui.list" },
      rows: 1000,
      rowHeight: 80,
      row: index => shopRow({ id: `item${index}`, price: index })
    };
    // @ts-expect-error — a windowed scroll needs `row` next to `rows`.
    const half: Tags["scroll"] = { rows: 1000, rowHeight: 80 };

    expectTypeOf(shop).not.toBeUndefined();
    expectTypeOf(half).not.toBeUndefined();
  });
});

describe("the snapshot of a windowed scroll", () => {
  it("reports the window on the scroll node", () => {
    expectTypeOf<UiNode["window"]>().toEqualTypeOf<
      { first: number; last: number; rows: number } | undefined
    >();
  });
});
