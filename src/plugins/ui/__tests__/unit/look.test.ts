import { describe, expect, it } from "vitest";
import { bind, component } from "../../../../index";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { type LookWriter, lookMoved, writeLook } from "../../jsx/look";
import type { Element } from "../../jsx/types";

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
    expect(moved({ sweep: 0.5, cap: "butt" })).toBe("both");
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

/** What a recording writer saw: the plays with their values, the whole writes and the other-field writes. */
type Seen = { plays: Array<[object, object]>; wholes: number; others: number };

/**
 * A writer that records every play and write, its play answering `motion`.
 *
 * @param motion - Whether the hook returns a motion.
 * @returns The writer and what it saw.
 */
function recordingWriter(motion: boolean): { writer: LookWriter; seen: Seen } {
  const seen: Seen = { plays: [], wholes: 0, others: 0 };
  const writer: LookWriter = {
    pass: 1,
    values: { previous: {}, next: {} },
    play: (_element, _name, values) => {
      seen.plays.push([values.previous, values.next]);

      return motion;
    },
    whole: () => {
      seen.wholes += 1;
    },
    others: () => {
      seen.others += 1;
    }
  };

  return { writer, seen };
}

/**
 * Writes the arc's look again with a patch, as the reconciler does for a hooked element.
 *
 * @param patch - What this render moved.
 * @param motion - Whether the hook returns a motion.
 * @returns What the writer saw.
 */
function write(patch: object, motion = true): Seen {
  const { writer, seen } = recordingWriter(motion);
  const next = Shape({ ...arc, ...patch });
  const element = { lookPass: undefined, lookFrom: undefined } as unknown as Element;

  writeLook(writer, element, next, arc, next.value);

  return seen;
}

describe("writeLook", () => {
  // Bug: a sweep-only change writes the arc's other fields again, or a new cap waits for the motion.
  it("plays for numbers, and writes the other fields only when they moved too", () => {
    expect(write({ sweep: 0.5 })).toMatchObject({ wholes: 0, others: 0 });
    expect(write({ sweep: 0.5 }).plays).toHaveLength(1);
    expect(write({ sweep: 0.5, cap: "butt" })).toMatchObject({ wholes: 0, others: 1 });
    expect(write({ cap: "butt" })).toEqual({ plays: [], wholes: 0, others: 1 });
    expect(write({})).toEqual({ plays: [], wholes: 0, others: 0 });
  });

  // Bug: a hook that answers no motion leaves the numbers of the old look on the element.
  it("writes the look whole when the hook returns no motion", () => {
    expect(write({ sweep: 0.5, cap: "butt" }, false)).toMatchObject({ wholes: 1, others: 0 });
  });
});
