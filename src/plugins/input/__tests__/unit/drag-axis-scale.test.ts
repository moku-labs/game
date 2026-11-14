import { describe, expect, it } from "vitest";
import { Parent, Transform, type TransformValue } from "../../../renderer/components";
import { Draggable } from "../../components";
import { grab, moveHeld, release } from "../../drag";
import { createMockInput, type MockInput } from "./mock-input";

// ---------------------------------------------------------------------------
// Unit: the drag of a hosted view passes the per-axis scale through (F179). The root pose written at the grab and the
// local pose written at the release carry `scaleX` / `scaleY` only when the view has them, so the drag of a plain view
// adds no key to the snapshot, and a stretched view keeps its stretch.
// ---------------------------------------------------------------------------

/**
 * Grabs an item at (100, 200) inside a slot at (40, 60) scaled 0.5, moves it and lets it go over nothing.
 *
 * @param mock - The mock input.
 * @param own - The item's own Transform fields.
 * @returns The Transform the item holds at the grab and after the release.
 */
function dragHosted(
  mock: MockInput,
  own: Partial<TransformValue>
): { grabbed: unknown; released: unknown } {
  const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
  const item = mock.spawn(
    [Draggable({}), Transform({ x: 100, y: 200, ...own }), Parent({ entity: slot })],
    { projection: "board.items", key: "i5" }
  );

  mock.state.entity = item;
  mock.state.phase = "dragging";
  grab(mock.input, item, { x: 90, y: 160 });

  const grabbed = { ...mock.read(item, Transform) };

  moveHeld(mock.input, { x: 120, y: 160 });
  release(mock.input, { x: 120, y: 160 });

  return { grabbed, released: mock.read(item, Transform) };
}

describe("the drag of a hosted view, per axis", () => {
  // Bug: the root and local poses always carry `scaleX: 1`, and every dragged view changes the snapshot.
  it("adds no scaleX or scaleY key to a plain view", () => {
    const { grabbed, released } = dragHosted(createMockInput(), {});

    for (const value of [grabbed, released]) {
      expect(Object.keys(value as object)).not.toContain("scaleX");
      expect(Object.keys(value as object)).not.toContain("scaleY");
    }
  });

  // Bug: the drag drops the factor, and the ribbon comes back unstretched.
  it("keeps scaleX 0.5 through the grab and the release", () => {
    const { grabbed, released } = dragHosted(createMockInput(), { scaleX: 0.5 });

    expect(grabbed).toMatchObject({ scale: 0.5, scaleX: 0.5 });
    expect(released).toMatchObject({ scale: 1, scaleX: 0.5 });
    expect(Object.keys(released as object)).not.toContain("scaleY");
  });
});
