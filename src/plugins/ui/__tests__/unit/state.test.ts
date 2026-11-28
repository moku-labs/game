import { describe, expect, it } from "vitest";
import { createJsxState } from "../../jsx/state";
import type { Element } from "../../jsx/types";
import { createNode, freeNode } from "../../layout/nodes";
import { createLayoutState } from "../../layout/state";
import { loadYogaModule } from "../../layout/yoga";
import { stopUi } from "../../lifecycle";
import { createUiState } from "../../state";
import { createStylesState } from "../../styles/state";
import type { Config } from "../../types";

const config: Config = {
  tapTargetPt: 44,
  breakpoints: { tall: 2, wide: 1.5 },
  focusRing: {
    stroke: 0x3a_22_12,
    strokeWidth: 4,
    dash: 10,
    offset: 9,
    halo: 0xff_f3_d6,
    haloWidth: 12
  },
  textInput: {
    caretWidth: 3,
    caret: 0x00_00_00,
    selection: 0x33_90_ff,
    selectionAlpha: 0.35,
    composingUnderline: 3,
    keyboardMargin: 16
  }
};

describe("createUiState", () => {
  it("composes one branch per module", () => {
    const state = createUiState({ config });

    expect(state.jsx.roots.size).toBe(0);
    expect(state.styles.viewport).toBeUndefined();
    expect(state.layout.nodes).toBe(0);
  });

  it("gives every app its own maps", () => {
    const first = createUiState({ config });
    const second = createUiState({ config });

    first.jsx.byKey.set(1, new Map([["coins", 1]]));

    expect(second.jsx.byKey.size).toBe(0);
  });
});

describe("the module state factories", () => {
  it("start the jsx module empty", () => {
    const state = createJsxState();

    expect(state.components.size).toBe(0);
    expect(state.elements.size).toBe(0);
    expect(state.exiting.size).toBe(0);
    expect(state.reconciles).toBe(0);
    expect(state.fields.size).toBe(0);
    expect(state.text.editing).toBeUndefined();
    expect(state.text.mirror).toEqual({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      direction: "none"
    });
  });

  it("starts the styles module portrait with no viewport", () => {
    expect(createStylesState().flags).toEqual({
      portrait: true,
      landscape: false,
      tall: false,
      wide: false
    });
  });

  it("starts the layout module without Yoga and with zero counters", () => {
    const state = createLayoutState();

    expect(state.yoga).toBeUndefined();
    expect(state.byEntity.size).toBe(0);
    expect(state.solves).toBe(0);
    expect(state.measured).toBe(0);
  });
});

describe("stopUi and the spare nodes (hp-2ab)", () => {
  it("frees the nodes put aside, so a second start takes none made by the Yoga of the first", async () => {
    // Bug caught: the stop frees the live nodes and forgets the spare, so its nodes leak and a second start, with a
    // new Yoga module, hands one of the old module's nodes to an element.
    const state = createUiState({ config });

    state.layout.yoga = await loadYogaModule();
    createNode(state.layout, { entity: 1 } as Element);
    createNode(state.layout, { entity: 2 } as Element);
    freeNode(state.layout, { entity: 2 } as Element);
    expect(state.layout.spare.length).toBe(1);

    stopUi(state);

    expect(state.layout.spare.length).toBe(0);
    expect(state.layout.spareKept.length).toBe(0);
    expect(state.layout.byEntity.size).toBe(0);
  });
});
