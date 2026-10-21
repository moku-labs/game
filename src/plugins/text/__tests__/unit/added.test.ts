import { describe, expect, it } from "vitest";
import { component } from "../../../world/ecs/define";
import { bind, Text } from "../../components";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The labels the flush of phase `layout` brings: `ui` adds a `Text` in its
// solve, after the layout system ran, and the flush attaches it at the end of
// the phase. `text` resolves exactly those right after the flush, before phase
// `sync`, so the renderer builds them with their string. `put` stands in for
// the flush: it attaches a component and fires the `onAdded` listeners.
// ---------------------------------------------------------------------------

/** The component a bound label of the batch shows. */
const Counter = component("Counter", { value: 0 });

/**
 * A started plugin whose layout system already ran this frame, with no label yet.
 *
 * @returns The mock plugin.
 */
function afterSystem(): MockText {
  const mock = createMockText();

  mock.start();
  mock.step();

  return mock;
}

describe("the labels the layout flush brings", () => {
  it("resolves and measures a label added after the layout system ran", () => {
    const mock = afterSystem();

    mock.world.put(1, Text, Text({ content: "7" }).value);
    mock.afterLayout();

    expect(mock.world.read(1, Text)?.resolved).toBe("7");
    expect(mock.state.measured.get(1)).toBeDefined();
  });

  it("resolves a bound label once the whole batch is attached, its component after it", () => {
    const mock = afterSystem();

    // The flush attaches `Text` first and the bound component after it, as `ui` lists them.
    mock.world.put(1, Text, Text({ style: "digits", bind: bind(Counter, "value") }).value);
    mock.world.put(1, Counter, { value: 3 });
    mock.afterLayout();

    expect(mock.world.read(1, Text)?.resolved).toBe("3");
  });

  it("skips a label whose Text left again in the same flush", () => {
    const mock = afterSystem();

    mock.world.put(1, Text, Text({ content: "7" }).value);
    mock.world.drop(1, Text);
    mock.world.put(2, Text, Text({ content: "8" }).value);
    mock.afterLayout();

    expect(mock.world.read(1, Text)).toBeUndefined();
    expect(mock.world.read(2, Text)?.resolved).toBe("8");
  });

  it("leaves the labels to the next layout phase while the world is not live", () => {
    const mock = afterSystem();

    mock.world.mode = "paused";
    mock.world.put(1, Text, Text({ content: "7" }).value);
    mock.afterLayout();

    expect(mock.world.read(1, Text)?.resolved).toBe("");

    mock.world.mode = "live";
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("7");
  });

  // Bug: a headless game walks in fast mode with no frame, a paused world runs no layout phase,
  // and the list of the labels that came grows for as long as that lasts.
  it("keeps no label that came while the world is not live", () => {
    const mock = afterSystem();

    mock.world.mode = "fast";
    mock.world.put(1, Text, Text({ content: "7" }).value);

    expect(mock.state.added).toEqual([]);
  });

  it("forgets the labels that came while live when the world is not live at the step", () => {
    const mock = afterSystem();

    mock.world.put(1, Text, Text({ content: "7" }).value);
    mock.world.mode = "paused";
    mock.afterLayout();

    expect(mock.state.added).toEqual([]);
    expect(mock.world.read(1, Text)?.resolved).toBe("");
  });

  // Bug (F45): `ui` writes a new content after the layout system ran, and the label showed the old line for a frame.
  it("resolves a label whose content changed after the layout system ran, in that frame", () => {
    const mock = afterSystem();

    mock.world.put(1, Text, Text({ content: "7" }).value);
    mock.afterLayout();
    mock.world.api.ecs.set(1, Text, { content: "8" });
    mock.afterLayout();

    expect(mock.world.read(1, Text)?.resolved).toBe("8");
  });
});
