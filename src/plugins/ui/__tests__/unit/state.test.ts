import { describe, expect, it } from "vitest";
import { createJsxState } from "../../jsx/state";
import { createLayoutState } from "../../layout/state";
import { createUiState } from "../../state";
import { createStylesState } from "../../styles/state";
import type { Config } from "../../types";

const config: Config = { tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 } };

describe("createUiState", () => {
  it("composes one branch per module", () => {
    const state = createUiState({ global: {}, config });

    expect(state.jsx.roots.size).toBe(0);
    expect(state.styles.viewport).toBeUndefined();
    expect(state.layout.nodes).toBe(0);
  });

  it("gives every app its own maps", () => {
    const first = createUiState({ global: {}, config });
    const second = createUiState({ global: {}, config });

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
