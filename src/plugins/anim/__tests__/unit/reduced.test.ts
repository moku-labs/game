import { describe, expect, it, vi } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineMotion } from "../../motion";
import { createAnimState } from "../../state";
import { defineAnimation, mark, sequence, sfx, tween, wait } from "../../timeline/steps";
import { createDriver } from "../../tween/driver";
import type { MotionKeyframe, Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";
import { createViewProbe, poseOf, stepProbe } from "./view-probe";

// ---------------------------------------------------------------------------
// Unit test: reduced motion. Every track but a loop takes 0 ms, a loop stands on its first key.
// Delta 6, item B6.
// ---------------------------------------------------------------------------

/**
 * Nothing is muted.
 *
 * @returns An empty field set.
 */
function open(): ReadonlySet<string> {
  return new Set();
}

/** A wiggle of 1 s that starts and ends tilted: its first key is not the rest pose. */
const WIGGLE: readonly MotionKeyframe[] = [
  { at: 0, Transform: { rotation: 0.1 } },
  { at: 0.5, ease: "linear", Transform: { rotation: -0.1 } },
  { at: 1, ease: "linear", Transform: { rotation: 0.1 } }
];

/** A card that pops in from half size and fades out. */
const card = defineMotion({
  states: { small: { Transform: { scale: 0.5 } }, gone: { Shape: { alpha: 0 } } },
  transition: { ms: 1000 },
  on: { enter: "small", exit: "gone" }
});

/** The same card entering along its keyframe track. */
const dropping = defineMotion({
  keyframes: {
    dropIn: [
      { at: 0, Transform: { dy: -780 } },
      { at: 0.5, Transform: { dy: 20 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "dropIn" }
});

/** The wiggle as a loop. */
const wiggling = defineMotion({
  keyframes: { wiggle: WIGGLE },
  transition: { ms: 1000 },
  loop: { track: "wiggle" },
  on: {}
});

/** A coin flies 600 ms, a sound plays, a mark is reached, and the timeline waits 200 ms. */
const coinFly = defineAnimation("hud.coinFly", {
  slots: { coin: type<Target>() },
  build: ({ coin }) =>
    sequence(
      tween(coin, Transform, { x: 300 }, { ms: 600, ease: "linear", delayMs: 100 }),
      sfx("board.merge"),
      mark("landed"),
      wait(200)
    )
});

describe("anim reduced motion — the switch", () => {
  it("starts from the config value and follows the API", () => {
    const off = createMockAnim();
    const on = createMockAnim({ reducedMotion: true });

    expect(off.api.reducedMotion()).toBe(false);
    expect(on.api.reducedMotion()).toBe(true);
    expect(on.api.setReducedMotion(false)).toBeUndefined();
    expect(on.api.reducedMotion()).toBe(false);
    expect(on.state.reducedMotion).toBe(false);

    off.api.setReducedMotion(true);

    expect(off.api.reducedMotion()).toBe(true);
  });

  it("keeps the live value in state, seeded from the config", () => {
    expect(createAnimState({ config: { maxTracks: 10, reducedMotion: true } }).reducedMotion).toBe(
      true
    );
    expect(createAnimState({ config: { maxTracks: 10, reducedMotion: false } }).reducedMotion).toBe(
      false
    );
  });
});

describe("anim reduced motion — every track but a loop takes 0 ms", () => {
  it("lands a driver track on its target on the next frame, its delay dropped", () => {
    const mock = createMockAnim({ reducedMotion: true });

    mock.start();

    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 400, ease: "linear", delayMs: 100 },
      open
    );

    mock.frame(16);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.active()).toBe(false);
  });

  it("lands a counted repeat on its target at once: it is not a loop", () => {
    const mock = createMockAnim({ reducedMotion: true });

    mock.start();

    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);

    driver.track(entity, Transform, { x: 100 }, { ms: 400, ease: "linear", repeat: 3 }, open);
    mock.frame(16);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.api.active()).toBe(0);
  });

  it("plays an enter state and an exit state in 0 ms", () => {
    const probe = createViewProbe({ reducedMotion: true });
    const entered = card.enter?.(probe.view, {});

    stepProbe(probe, 16);

    expect(poseOf(probe).scale).toBe(1);
    expect(entered?.active()).toBe(false);

    const exited = card.exit?.(probe.view, {});

    stepProbe(probe, 16);

    expect(poseOf(probe).alpha).toBe(0);
    expect(exited?.active()).toBe(false);
  });

  it("walks an enter keyframe track in 0 ms, straight to the rest pose", () => {
    const probe = createViewProbe({ reducedMotion: true });
    const entered = dropping.enter?.(probe.view, {});

    stepProbe(probe, 16);

    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });
    expect(entered?.active()).toBe(false);
  });

  it("runs a timeline tween in 0 ms, and its sound and mark still fire", () => {
    const mock = createMockAnim({ reducedMotion: true });

    mock.start();

    const coin = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(coinFly, { coin });

    mock.frame(16);

    expect(mock.world.ecs.get(coin, Transform)?.x).toBe(300);
    expect(handle.marks()).toEqual(["landed"]);
    expect(mock.dispatched).toContainEqual(expect.objectContaining({ kind: "sfx" }));
    // `wait` is no track: the timeline still waits its 200 ms.
    expect(handle.active()).toBe(true);

    mock.frame(200);

    expect(handle.active()).toBe(false);
  });
});

describe("anim reduced motion — loops", () => {
  it("stands a loop on its first key and keeps it running", () => {
    const probe = createViewProbe({ reducedMotion: true });

    wiggling.loop?.(probe.view);
    stepProbe(probe, 16);

    expect(poseOf(probe).rotation).toBe(0.1);

    stepProbe(probe, 500);

    expect(poseOf(probe).rotation).toBe(0.1);
    expect(probe.mock.api.active()).toBe(1);
  });

  it("stops a running loop at once and lets it move again from its first key", () => {
    const probe = createViewProbe();

    wiggling.loop?.(probe.view);
    stepProbe(probe, 250);

    expect(poseOf(probe).rotation).toBeCloseTo(0, 6);

    probe.mock.api.setReducedMotion(true);
    stepProbe(probe, 16);

    expect(poseOf(probe).rotation).toBe(0.1);

    stepProbe(probe, 300);

    expect(poseOf(probe).rotation).toBe(0.1);

    probe.mock.api.setReducedMotion(false);
    stepProbe(probe, 250);

    expect(poseOf(probe).rotation).toBeCloseTo(0, 6);
  });

  it("applies to tracks started after the switch; a running track keeps its length", () => {
    const mock = createMockAnim();

    mock.start();

    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear" }, open);
    mock.api.setReducedMotion(true);
    driver.track(entity, Transform, { y: 100 }, { ms: 100, ease: "linear" }, open);
    mock.frame(50);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 50, y: 100 });
    expect(mock.api.active()).toBe(1);
  });
});

describe("anim reduced motion — a held loop writes once", () => {
  it("writes its first key when the hold begins, not every frame, and again after it walked", () => {
    const mock = createMockAnim({ reducedMotion: true });
    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);
    const set = vi.spyOn(mock.world.ecs, "set");
    const writes = (): number => set.mock.calls.filter(([target]) => target === entity).length;

    mock.start();
    driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 400, ease: "linear", repeat: "forever" },
      open
    );

    for (let frame = 0; frame < 5; frame += 1) mock.frame(16);

    expect(writes()).toBe(1);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);

    // Off: the loop walks from its first key and writes every frame.
    mock.api.setReducedMotion(false);
    mock.frame(100);
    mock.frame(100);

    expect(writes()).toBe(3);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);

    // On again: one write back to the first key, then nothing.
    mock.api.setReducedMotion(true);

    for (let frame = 0; frame < 5; frame += 1) mock.frame(16);

    expect(writes()).toBe(4);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);
    expect(mock.api.active()).toBe(1);
  });

  it("still ends a held loop whose entity died", () => {
    const mock = createMockAnim({ reducedMotion: true });
    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);

    mock.start();

    const handle = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 400, ease: "linear", repeat: "forever" },
      open
    );

    mock.frame(16);
    mock.world.ecs.despawn(entity);
    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });
});
