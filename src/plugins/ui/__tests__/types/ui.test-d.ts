import { describe, expectTypeOf, it } from "vitest";
import { defineMotion } from "../../../anim/motion";
import type { Descriptor } from "../../../flow/fx/types";
import { Transform, type TransformValue } from "../../../renderer/components";
import type { Entity, Motion, ViewHandle } from "../../../world/types";
import type { BoxValue } from "../../components";
import { popup, uiFor } from "../../components";
import { defineComponent } from "../../jsx/component";
import type { Finding, UiNode } from "../../jsx/types";
import { defineStyle } from "../../styles/define";
import type { ElementChange, ElementMotion, UiApi } from "../../types";

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
