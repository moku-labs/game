import { describe, expect, it } from "vitest";
import { bind, component } from "../../../../index";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { lookMoved } from "../../jsx/look";

// ---------------------------------------------------------------------------
// Unit: the look check of the visual `change` hooks (F85). Each of the four visuals is compared
// by its own fields: a number that moved plays the hook, another field is written at once, and
// a look that says the same writes nothing.
// ---------------------------------------------------------------------------

/** A game's counter, as a bound label shows it. */
const Counter = component("LookCounter", { value: 0 });

/** The XP arc of a level ring, as `visualOf` writes it. */
const arc = Shape({
  kind: "arc",
  w: 32,
  h: 32,
  alpha: 0.97,
  strokeWidth: 3.6,
  sweep: 0.25,
  cap: "round"
}).value;

describe("lookMoved", () => {
  // Bug: a number of a Shape missing from its comparator never plays change.Shape; an end or a kind read as a number
  // starts a motion for a field no track can move.
  it("tells the numbers of a Shape from its kind, clip and ends", () => {
    const moved = (patch: object) => lookMoved(Shape, arc, { ...arc, ...patch });

    expect(moved({ w: 64 })).toBe("numbers");
    expect(moved({ sweep: 0.5 })).toBe("numbers");
    expect(moved({ cap: "butt" })).toBe("others");
    expect(moved({ clip: true })).toBe("others");
    expect(moved({})).toBe("none");

    // A rectangle after the arc: its kind moved, and the sweep it leaves out is not read.
    const rect = Shape({ w: 32, h: 32, alpha: 0.97, strokeWidth: 3.6 }).value;

    expect(lookMoved(Shape, arc, rect)).toBe("others");
  });

  // Bug: an image that grows reports no move, so its change.Sprite never plays.
  it("tells the numbers of a Sprite from its texture, fit and anchor", () => {
    const coin = Sprite({ texture: "ui.coin", width: 40, height: 40, alpha: 0.85 }).value;
    const moved = (patch: object) => lookMoved(Sprite, coin, { ...coin, ...patch });

    expect(moved({ width: 80 })).toBe("numbers");
    expect(moved({ tint: 0xff_00_00 })).toBe("numbers");
    expect(moved({ texture: "ui.gem" })).toBe("others");
    expect(moved({ anchor: { x: 0, y: 0.5 } })).toBe("others");
    expect(moved({ anchor: { ...coin.anchor } })).toBe("none");
  });

  // Bug: a panel that fades reports no move, or a rim that turns hollow starts a motion.
  it("tells the numbers of a NineSlice from its texture and rim", () => {
    const panel = NineSlice({ texture: "ui.panel", width: 600, height: 400 }).value;
    const moved = (patch: object) => lookMoved(NineSlice, panel, { ...panel, ...patch });

    expect(moved({ alpha: 0.5 })).toBe("numbers");
    expect(moved({ height: 420 })).toBe("numbers");
    expect(moved({ hollow: true })).toBe("others");
    expect(moved({ blend: "add" })).toBe("others");
    expect(moved({})).toBe("none");
  });

  // Bug: a label written with a new message or bind of the same words is taken for a new look; a box that moves is not.
  it("tells the numbers of a Text from its words, and reads a new message or bind by what it says", () => {
    const words = { content: { key: "hud.coins", params: { n: 5 } }, bind: bind(Counter, "value") };
    const label = Text({ ...words, box: 120 }).value;
    const moved = (patch: object) => lookMoved(Text, label, { ...label, ...patch });

    expect(moved({ alpha: 0.5 })).toBe("numbers");
    expect(moved({ box: 160 })).toBe("numbers");
    expect(moved({ content: { key: "hud.coins", params: { n: 5 } } })).toBe("none");
    expect(moved({ content: { key: "hud.coins", params: { n: 6 } } })).toBe("others");
    expect(moved({ content: { key: "hud.coins", params: { n: 5, m: 1 } } })).toBe("others");
    expect(moved({ bind: bind(Counter, "value") })).toBe("none");
    expect(moved({ bind: bind(Counter, "value", { format: "mm:ss" }) })).toBe("others");
    expect(moved({ style: "digits" })).toBe("others");

    // A text that starts to wrap at its box: the box arrives, it does not move.
    expect(lookMoved(Text, Text(words).value, label)).toBe("others");
  });

  // Bug: a component that is none of the four visuals would be compared as one of them.
  it("leaves any other component to its hook", () => {
    const pose = Transform().value;

    expect(lookMoved(Transform, pose, pose)).toBe("numbers");
  });
});
