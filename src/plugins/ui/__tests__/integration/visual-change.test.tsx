import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape } from "../../../../index";
import { PointerOver, Pressed } from "../../../input/components";
import {
  ARC_MS,
  answerNext,
  BAR_MS,
  type ExitsApp,
  frames,
  shapeCalls,
  startExits
} from "../exits-app";

// ---------------------------------------------------------------------------
// Integration: the `change` hook of the visual an element is drawn with (F85). A render or a
// restyle that moves a number of the element's `Shape` plays `motion.change.Shape` with the look
// before and after, as a `change` hook of an extra plays; the motion brings the numbers home, the
// other fields are written at once, and a dev build names a hook `ui` never plays. Real flow,
// world and anim; plain Bun, inert renderer, real Yoga.
// ---------------------------------------------------------------------------

/** The frames a walk of the XP arc takes, and one more. */
const ARC_FRAMES = Math.ceil(ARC_MS / 16) + 1;

/**
 * The sweep the XP arc of the ring is drawn with now.
 *
 * @param app - The running app.
 * @returns The sweep of its `Shape`.
 */
function sweepOf(app: ExitsApp): number | undefined {
  return app.world.ecs.get(app.ui.find("xpArc") ?? 0, Shape)?.sweep;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the change hook of an element's Shape (F85)", () => {
  // Bug (A Memory Missing, the XP arc of the level ring): `change.Shape` never played, so a new share jumped.
  it("walks the XP arc to a new share over 520 ms, as the game's arcMotion asks, instead of jumping", async () => {
    const app = await startExits("exits.ring");
    const arc = app.ui.find("xpArc") ?? 0;

    await answerNext(app, "ringNext");

    expect(shapeCalls).toHaveLength(1);
    expect(shapeCalls[0]?.previous).toMatchObject({ kind: "arc", sweep: 0 });
    expect(shapeCalls[0]?.next).toMatchObject({ kind: "arc", sweep: 0.25 });
    expect(app.world.projection.restOf(arc, Shape)?.sweep).toBe(0.25);
    expect(sweepOf(app)).toBeLessThan(0.1);

    // Half way through the walk the arc stands between the two shares.
    frames(app, Math.round(ARC_FRAMES / 2));

    expect(sweepOf(app)).toBeGreaterThan(0.1);
    expect(sweepOf(app)).toBeLessThan(0.25);

    frames(app, ARC_FRAMES);

    expect(sweepOf(app)).toBeCloseTo(0.25, 6);
    expect(app.ui.find("xpArc")).toBe(arc);

    await app.stop();
  });

  // Bug: a second share while the arc walks leaves the first walk running against the second.
  it("cancels the walk the last change started and plays the next one from the share before it", async () => {
    const app = await startExits("exits.ring");

    await answerNext(app, "ringNext");
    frames(app, 5);
    await answerNext(app, "ringNext");

    expect(shapeCalls.map(call => [call.previous.sweep, call.next.sweep])).toEqual([
      [0, 0.25],
      [0.25, 0.5]
    ]);
    expect(shapeCalls[0]?.motion?.active()).toBe(false);
    expect(shapeCalls[1]?.motion?.active()).toBe(true);

    frames(app, ARC_FRAMES);

    expect(sweepOf(app)).toBeCloseTo(0.5, 6);

    await app.stop();
  });

  // Bug: a hover on the ring mid-walk writes the whole Shape again and snaps the arc to its end.
  it("writes nothing for a restyle that leaves the look as it is, so the walk runs on", async () => {
    const app = await startExits("exits.ring");
    const arc = app.ui.find("xpArc") ?? 0;

    await answerNext(app, "ringNext");
    frames(app, 3);

    const walking = sweepOf(app) ?? 0;

    app.world.ecs.tag(arc, PointerOver);

    expect(sweepOf(app)).toBe(walking);
    expect(shapeCalls).toHaveLength(1);
    expect(shapeCalls[0]?.motion?.active()).toBe(true);

    await app.stop();
  });

  // Bug: while the hook tweens a number the other fields of the render wait for it, or never land.
  it("writes the fields that are no number at once while the hook tweens a number", async () => {
    const app = await startExits("exits.gauge");
    const bar = app.ui.find("gaugeBar") ?? 0;

    await answerNext(app, "gaugeNext");

    expect(
      shapeCalls
        .filter(call => call.key === "gaugeBar")
        .map(call => [call.previous.alpha, call.next.alpha])
    ).toEqual([[0.4, 0.8]]);
    expect(app.world.ecs.get(bar, Shape)).toMatchObject({ cap: "butt" });
    expect(app.world.ecs.get(bar, Shape)?.alpha).toBeLessThan(0.5);

    frames(app, Math.ceil(BAR_MS / 16) + 1);

    expect(app.world.ecs.get(bar, Shape)?.alpha).toBeCloseTo(0.8, 6);

    await app.stop();
  });

  // Bug: a render that grows a bar and brightens it played the hook again after the solve with the new alpha as the
  // old one, so the hook answered nothing and the alpha jumped.
  it("plays a hook from the look before the render when the solve that follows moves the rect", async () => {
    const app = await startExits("exits.gauge");
    const grow = app.ui.find("gaugeGrow") ?? 0;

    await answerNext(app, "gaugeNext");

    const calls = shapeCalls.filter(call => call.key === "gaugeGrow");

    // Once for the render, once for the solve that gave it its new width: both from the look before.
    expect(calls.map(call => [call.previous.alpha, call.next.alpha, call.next.w])).toEqual([
      [0.4, 0.8, 40],
      [0.4, 0.8, 80]
    ]);
    expect(calls[0]?.motion?.active()).toBe(false);
    expect(app.world.ecs.get(grow, Shape)?.alpha).toBeLessThan(0.5);

    frames(app, Math.ceil(BAR_MS / 16) + 1);

    expect(app.world.ecs.get(grow, Shape)).toMatchObject({ w: 80, alpha: 0.8 });

    await app.stop();
  });

  // Bug: a variant that trades the Shape for a nine-slice leaves the Shape's motion running on a component that left.
  it("cancels the motion of a visual the element trades for another", async () => {
    const app = await startExits("exits.gauge");
    const bar = app.ui.find("gaugeBar") ?? 0;

    await answerNext(app, "gaugeNext");
    frames(app, 3);
    await answerNext(app, "gaugeNext");

    expect(app.world.ecs.has(bar, Shape)).toBe(false);
    expect(shapeCalls.find(call => call.key === "gaugeBar")?.motion?.active()).toBe(false);

    await app.stop();
  });

  // Bug: a hook that answers no motion leaves the old look on the element.
  it("writes the whole look at once when the hook returns no motion", async () => {
    const app = await startExits("exits.ring");
    const arc = app.ui.find("xpArc") ?? 0;

    // A press dims the arc and leaves its share: the hook returns nothing for it.
    app.world.ecs.tag(arc, Pressed);

    expect(shapeCalls.map(call => [call.previous.alpha, call.next.alpha, call.motion])).toEqual([
      [0.97, 0.5, undefined]
    ]);
    expect(app.world.ecs.get(arc, Shape)?.alpha).toBe(0.5);

    await app.stop();
  });
});

/**
 * Starts the hooked image in a dev build, or in a release build, every warning kept.
 *
 * @param dev - Whether the dev flag is on.
 * @returns The app and the data of every `ui:change-never-plays` warning.
 */
async function startIdle(dev: boolean) {
  const warned: Array<{ event: string; data: unknown }> = [];

  vi.stubGlobal("__MOKU_GAME_DEV__", dev);
  vi.spyOn(console, "warn").mockImplementation((entry: { event: string; data: unknown }) => {
    warned.push(entry);
  });

  const app = await startExits("exits.idle");
  const never = (): unknown[] =>
    warned.filter(entry => entry.event === "ui:change-never-plays").map(entry => entry.data);

  return { app, never };
}

describe("a change hook ui never plays (F85)", () => {
  // Bug: `change.Shape` on an image (drawn with a Sprite) or a hook of a component it does not carry is a silent trap.
  it("names each hook of no rect, pose, visual or extra of the element once, in a dev build", async () => {
    const { app, never } = await startIdle(true);

    expect(never()).toEqual([
      { key: "idlePic", name: "Shape" },
      { key: "idlePic", name: "Alpha" }
    ]);

    // A new motion with one more such hook names that one alone.
    await answerNext(app, "idleNext");
    frames(app, 1);

    expect(never()).toEqual([
      { key: "idlePic", name: "Shape" },
      { key: "idlePic", name: "Alpha" },
      { key: "idlePic", name: "Tick" }
    ]);

    await app.stop();
  });

  it("names nothing in a release build", async () => {
    const { app, never } = await startIdle(false);

    await answerNext(app, "idleNext");

    expect(never()).toEqual([]);

    await app.stop();
  });
});
