import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { advanceTracks, beginFrame, sampleBorn, startTrack } from "../../tween/advance";
import { startStepTrack } from "../../tween/driver";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: the pass before the draw (F241). A track born after the frame step writes its sample at
// its start before the frame is drawn, and the next step advances it from there by one delta.
// ---------------------------------------------------------------------------

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/** An additive walk that jumps to 300 at once and comes home over 600 ms, as `ladder-in` walks. */
const WALK = {
  ms: 600,
  additive: true,
  segments: [
    { at: 0.0005, ease: () => 1, to: { y: 300 } },
    { at: 1, ease: (t: number) => t, to: { y: 0 } }
  ]
} as const;

describe("anim sampleBorn", () => {
  // Bug: the walk stands at rest in the frame it is born; or the pass hands it a delta, so the
  // whole enter runs one frame early.
  it("writes a born walk's start pose, and the next step moves it one frame on", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const y = (): number | undefined => mock.world.ecs.get(entity, Transform)?.y;

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);
    startTrack(mock.actx, entity, Transform, { y: 0 }, WALK, open);
    sampleBorn(mock.actx);

    expect(y()).toBe(300);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    expect(y()).toBeCloseTo(292, 0);
  });

  // Bug: a track still in its delay is written before its time.
  it("writes nothing for a track born in its delay", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);
    startTrack(mock.actx, entity, Transform, { y: 0 }, { ...WALK, delayMs: 100 }, open);
    sampleBorn(mock.actx);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(0);
  });

  // Bug: a 0 ms track ends in the pass, a frame before the step where an additive loop re-bases on it (F47).
  it("leaves a born track of 0 ms to the next step", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    const track = startTrack(
      mock.actx,
      entity,
      Transform,
      { y: 40 },
      { ms: 0, additive: true },
      open
    );

    sampleBorn(mock.actx);

    expect(track.ended).toBe(false);
  });

  // Bug: a track born inside the step (an `onMark` listener) is skipped by it and stands a frame at rest.
  it("writes the start pose of a walk born inside the step", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

    beginFrame(mock.actx);
    startTrack(mock.actx, entity, Transform, { y: 0 }, WALK, open);
    advanceTracks(mock.actx, 16);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(0);

    sampleBorn(mock.actx);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(300);
  });

  // Bug: the pass advances a track a timeline step drives, which the step hands its time itself.
  it("leaves a track a timeline step drives to that step", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);
    startStepTrack(mock.actx, entity, Transform, { y: 0 }, WALK);
    sampleBorn(mock.actx);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(0);
  });

  // Bug (F241, ticktoe's level knob): the first sample of an absolute `outBack` tween moved its field 1e-13 off the
  // start (407.00000000000006); or the track, sampled before the draw, did not end exactly on its target.
  it("leaves an outBack tween exactly at its start in the first frame, and ends it exactly on its target", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 407, y: 0 })]);
    const x = (): number | undefined => mock.world.ecs.get(entity, Transform)?.x;

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    const track = startTrack(
      mock.actx,
      entity,
      Transform,
      { x: 587 },
      { ms: 220, ease: "outBack" },
      open
    );

    sampleBorn(mock.actx);

    expect(x()).toBe(407);

    for (let frame = 0; frame < 15; frame += 1) {
      beginFrame(mock.actx);
      advanceTracks(mock.actx, 16);
      sampleBorn(mock.actx);
    }

    expect(track.ended).toBe(true);
    expect(x()).toBe(587);
  });
});
