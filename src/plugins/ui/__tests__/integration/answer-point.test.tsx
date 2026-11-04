import { afterEach, describe, expect, it, vi } from "vitest";
import { Box } from "../../components";
import {
  type AnswerApp,
  frames,
  pointer,
  type Started,
  seen,
  startAnswerApp,
  tick
} from "../answer-app";

// ---------------------------------------------------------------------------
// Integration: a popup answer carries its moment (F137), a `point` button its
// press point (F139). A finger tap on the fake canvas goes through the
// renderer's hit test and the gesture machine; the node awaits the popup on a
// fake clock. Real flow, world, input and Yoga.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: AnswerApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.unstubAllGlobals();
});

/**
 * Starts the fixture with the gift popup on screen.
 *
 * @returns The app, its fake Pixi and its clock.
 */
async function started(): Promise<Started> {
  const value = await startAnswerApp();

  running = value.app;

  return value;
}

/**
 * The laid-out rect of the sphere button, in reference units.
 *
 * @param app - The running app.
 * @returns Its `Box`.
 */
function sphereBox(app: AnswerApp): { x: number; y: number; w: number; h: number } {
  const entity = app.ui.find("sphere");
  const box = entity === undefined ? undefined : app.world.ecs.get(entity, Box);

  if (box === undefined) throw new Error("the sphere is not laid out");

  return box;
}

describe("a popup button with point, tapped by a finger", () => {
  // Bug: the press point reaches the node in root units (or the box origin is the centre), so a
  // game that splits the sphere into a left and a right half reads the wrong half; or `at` is the
  // moment the popup opened, not the moment of the tap.
  it("resolves the node with the press point in the button's units and the moment of the answer", async () => {
    const app = await started();
    const box = sphereBox(app.app);

    // The panel stands at (300, 500) with a padding of 100: the sphere is not at the root origin.
    expect(box).toEqual({ x: 400, y: 600, w: 400, h: 200 });

    app.clock.advance(5000);
    pointer(app, "pointerdown", { x: box.x + 10, y: box.y + 150 });
    frames(app.app, 1);
    app.clock.advance(300);
    pointer(app, "pointerup", { x: box.x + 12, y: box.y + 150 });
    frames(app.app, 1);
    await tick();

    // The press-down point, not the release point; (0, 0) is the top-left corner of the button.
    expect(seen.answer).toStrictEqual({
      intent: "kitTap",
      payload: { point: { x: 10, y: 150 } },
      at: 65_300
    });
  });
});

describe("a popup button with point, tapped by the keyboard", () => {
  // Bug: the keyboard path of ui hands input a made-up point (the centre, or 0, 0), so a node
  // cannot tell Escape from a tap on the sphere's corner.
  it("answers without a point key", async () => {
    const app = await started();

    app.clock.advance(1000);
    app.app.input.pressKey("Escape");
    frames(app.app, 1);
    await tick();

    expect(seen.answer).toStrictEqual({ intent: "kitTap", payload: {}, at: 61_000 });
  });
});
