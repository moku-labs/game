import { describe, expectTypeOf, it } from "vitest";
import type { Descriptor } from "../../../flow/fx/types";
import type { Entity } from "../../../world/types";
import { popup, uiFor } from "../../components";
import { defineComponent } from "../../jsx/component";
import type { Finding, UiNode } from "../../jsx/types";
import { defineStyle } from "../../styles/define";
import type { UiApi } from "../../types";

const Reward = defineComponent("Reward", {
  outcomes: { claim: {} as { orderId: string } },
  view: (props: { gold: number }) => ({
    type: "panel",
    props: { gold: props.gold },
    children: []
  })
});

const Plain = defineComponent("Plain", { view: () => ({ type: "row", props: {}, children: [] }) });

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
    expectTypeOf(kit.intrinsics.panel.nineSlice).toEqualTypeOf<
      "ui.coin" | "ui.panel" | undefined
    >();
    expectTypeOf(kit.intrinsics.text.style).toEqualTypeOf<
      "digits" | import("../../styles/types").Style | undefined
    >();
  });
});
