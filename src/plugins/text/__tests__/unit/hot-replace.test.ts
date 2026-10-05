import { describe, expect, it } from "vitest";
import type { Entity } from "../../../world/ecs/types";
import { defineTextStyles, Text } from "../../components";
import type { TextValue } from "../../types";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type FakeObject, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// `text.replaceStyles`: the dev hot swap of a styles file. The style table
// takes the new map, and a label whose text and style name stand still
// redraws with the new style on the next frame.
// ---------------------------------------------------------------------------

/** The entity the label sits on. */
const label: Entity = 1;

/** A started plugin whose renderer draws, with one feature style `hud.title`. */
function drawing(): MockText {
  const mock = createMockText({
    features: [
      {
        name: "hud",
        description: {
          textStyles: defineTextStyles({
            "hud.title": { font: "ui.font-body", size: 40, fill: 0xff_e0_82 }
          })
        }
      }
    ]
  });

  mock.renderer.ready = true;
  mock.start();

  return mock;
}

/** One `Text` value with the fields a case is about. */
function value(over: Partial<TextValue> = {}): TextValue {
  return { ...Text.defaults, ...over };
}

/** The registered display adapter. */
function adapterOf(mock: MockText): NonNullable<MockText["renderer"]["provided"][0]>["adapter"] {
  const entry = mock.renderer.provided[0];

  if (entry === undefined) throw new Error("no adapter was registered");

  return entry.adapter;
}

/** The Pixi style the first BitmapText of a container was built with. */
function glyphStyle(object: FakeObject): Record<string, unknown> {
  return object.children[0]?.options.style as Record<string, unknown>;
}

/**
 * Puts a label in the world, runs a frame, and builds its container, as the renderer does.
 *
 * @param mock - The mock plugin.
 * @param style - The style name of the label.
 * @returns The container and the value it was built from.
 */
function mounted(mock: MockText, style: string): { object: FakeObject; shown: TextValue } {
  mock.world.put(label, Text, value({ content: "12", style }));
  mock.step();

  const shown = mock.world.read(label, Text) as TextValue;

  return { object: adapterOf(mock).create(shown, 1) as FakeObject, shown };
}

/**
 * Runs a frame and hands the renderer update the value before and after it, as phase `sync` does
 * for a `changed(Text)`.
 *
 * @param mock - The mock plugin.
 * @param object - The container of the label.
 * @param previous - The value the container was last updated with.
 */
function frame(mock: MockText, object: FakeObject, previous: TextValue): void {
  mock.step();
  adapterOf(mock).update(object, previous, mock.world.read(label, Text) as TextValue);
}

describe("replaceStyles", () => {
  it("redraws a label whose text and style name did not change with the new size and colour", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, "hud.title");

    expect(glyphStyle(object)).toMatchObject({ fontSize: 40, fill: 0xff_e0_82 });

    mock.api.replaceStyles(
      defineTextStyles({ "hud.title": { font: "ui.font-body", size: 64, fill: 0xff_00_00 } })
    );
    frame(mock, object, shown);

    expect(glyphStyle(object)).toMatchObject({ fontSize: 64, fill: 0xff_00_00 });
    expect(mock.api.measure("12", "hud.title").height).toBeCloseTo(76.8, 5);
  });

  it("marks every label, drops the layout cache and wakes the loop", () => {
    const mock = drawing();

    mounted(mock, "hud.title");
    mock.api.measure("34", "hud.title");
    mock.api.replaceStyles(
      defineTextStyles({ "hud.title": { font: "ui.font-body", size: 64, fill: 0 } })
    );

    expect(mock.state.dirty.has(label)).toBe(true);
    expect(mock.state.cache.size).toBe(0);
    expect(mock.wake).toHaveBeenCalledTimes(1);
  });

  it("adds a new style name, usable at once, and keeps the owner of an existing name", () => {
    const mock = drawing();

    mock.api.replaceStyles(
      defineTextStyles({
        "hud.title": { font: "ui.font-body", size: 40, fill: 0 },
        "hud.badge": { font: "ui.font-body", size: 20, fill: 0 }
      })
    );

    expect(mock.api.styles()).toEqual(["body", "digits", "hud.title", "hud.badge"]);
    expect(mock.api.measure("12", "hud.badge").height).toBeCloseTo(24, 5);
    expect(mock.state.styleOwner.get("hud.title")).toBe("hud");
    expect(mock.state.styleOwner.has("hud.badge")).toBe(true);
  });

  it("installs the font a new style names when assets has it", () => {
    const mock = drawing();

    mock.assets.fonts.set("ui.font-title", { fnt: miniFontJson, texture: undefined as never });
    mock.api.replaceStyles(
      defineTextStyles({ "hud.title": { font: "ui.font-title", size: 32, fill: 0 } })
    );

    expect(mock.state.fontKeys.has("ui.font-title")).toBe(true);
    expect(mock.renderer.installed).toContain("ui.font-title");
    expect(mock.api.measure("12", "hud.title")).toEqual({ width: 36, height: 40 });
  });

  it("keeps the early return when the style was not replaced: nothing is rebuilt", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, "hud.title");
    const before = object.children[0];

    adapterOf(mock).update(object, shown, { ...shown });

    expect(object.children[0]).toBe(before);
    expect(object.children).toHaveLength(1);
  });
});
