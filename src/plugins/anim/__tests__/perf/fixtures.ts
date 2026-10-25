/**
 * @file anim plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture is
 * built here, outside any measured window, over the mock anim world of the unit tests, and hands
 * back one frame step of the code under measure.
 */
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { AnimPlayer } from "../../components";
import { createRuntime } from "../../lifecycle";
import { advanceTimelines } from "../../timeline/play";
import {
  defineAnimation,
  frames,
  parallel,
  sequence,
  tween,
  use,
  wait
} from "../../timeline/steps";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { cubicBezier } from "../../tween/bezier";
import { createDriver } from "../../tween/driver";
import { easeCell } from "../../tween/easing";
import type { Target } from "../../types";
import { createMockAnim, type MockAnim, spawnTestEntity } from "../unit/mock-anim";

/** A frame of a phone: fractional, so every clock and value holds doubles as on a device. */
export const FRAME_MS = 16.6;

/**
 * A wait no window reaches the end of: eleven days, and still a small whole number, as the lengths
 * a game writes are.
 */
const FOREVER_MS = 1e9;

/**
 * The length of a running tween: nearly three hours, so none ends inside the warm-ups and the
 * windows (some 1 000 s of frames), and short enough that every frame moves every field it drives.
 */
const TWEEN_MS = 1e7;

/**
 * How many frame steps a fixture runs before it is handed out. V8 compiles the step in the
 * background while it warms; a compile that lands inside a measured window reads as garbage, so
 * the fixture runs past them first.
 */
const WARM_STEPS = 20_000;

/**
 * Runs a frame step until V8 has compiled it, and hands it out.
 *
 * @param step - One frame step of a fixture.
 * @returns The same step, warm.
 */
function warmed(step: () => void): () => void {
  for (let index = 0; index < WARM_STEPS; index++) step();

  return step;
}

/** How many tracks the track fixtures run. */
const TRACKS = 50;

/** How many timelines the timeline fixtures run. */
const TIMELINES = 10;

/** The fields nobody mutes, one set for every track, so the fixture's own `muted` allocates nothing. */
const NONE: ReadonlySet<string> = Object.freeze(new Set<string>());

/**
 * The muted fields of a track nobody mutes.
 *
 * @returns The shared empty set.
 */
function nothingMuted(): ReadonlySet<string> {
  return NONE;
}

/** A bob: down half a step and back, forever, as an additive walk of offsets. */
const BOB = [
  { at: 0.5, to: { y: -7.5 } },
  { at: 1, to: { y: 0 } }
];

/**
 * Starts the bobbing loop of the track fixtures on one entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity that bobs.
 */
function startBob(mock: MockAnim, entity: number): void {
  createDriver(mock.actx).track(
    entity,
    Transform,
    { y: 0 },
    { ms: 1000, ease: "inOut", additive: true, repeat: "forever", segments: BOB },
    nothingMuted
  );
}

/**
 * The track table with 50 tracks running on 50 entities: 25 absolute tweens of `x` and `y`, and
 * 25 additive bobbing loops of `y`, the two kinds the frame step advances in its two passes.
 * Every frame moves 75 fields.
 *
 * @returns One frame step of the track table.
 */
export function tracksFixture(): () => void {
  const mock = createMockAnim();
  const driver = createDriver(mock.actx);

  for (let index = 0; index < TRACKS; index++) {
    const entity = spawnTestEntity(mock, [Transform({ x: index, y: index })]);

    if (index % 2 === 0) {
      driver.track(
        entity,
        Transform,
        { x: 500, y: 300 },
        { ms: TWEEN_MS, ease: "inOut" },
        nothingMuted
      );
    } else {
      startBob(mock, entity);
    }
  }

  return warmed((): void => {
    beginFrame(mock.actx);
    advanceTracks(mock.actx, FRAME_MS);
  });
}

/** The fields a hand holds on every view of the partial fixture: `y`, one set for every track. */
const HELD_Y: ReadonlySet<string> = new Set(["y"]);

/**
 * The muted fields of a track whose `y` a hand holds.
 *
 * @returns The shared set of `y`.
 */
function yHeld(): ReadonlySet<string> {
  return HELD_Y;
}

/**
 * The track table with 50 tweens of `x` and `y` whose `y` another writer holds: every frame moves
 * `x` only, so every track writes a patch of some of its fields. Every frame moves 50 fields.
 *
 * @returns One frame step of the track table.
 */
export function partialTracksFixture(): () => void {
  const mock = createMockAnim();
  const driver = createDriver(mock.actx);

  for (let index = 0; index < TRACKS; index++) {
    const entity = spawnTestEntity(mock, [Transform({ x: index, y: index })]);

    driver.track(entity, Transform, { x: 500, y: 300 }, { ms: TWEEN_MS, ease: "inOut" }, yHeld);
  }

  return warmed((): void => {
    beginFrame(mock.actx);
    advanceTracks(mock.actx, FRAME_MS);
  });
}

/**
 * The track table with 50 bobbing loops whose views the player cannot see: the renderer holds
 * them, so every frame walks every track and writes nothing.
 *
 * @returns One frame step of the track table.
 */
export function heldLoopsFixture(): () => void {
  const mock = createMockAnim();

  for (let index = 0; index < TRACKS; index++) {
    startBob(mock, spawnTestEntity(mock, [Transform({ x: index, y: index })]));
  }

  mock.state.loopsHeld = (): boolean => true;

  return warmed((): void => {
    beginFrame(mock.actx);
    advanceTracks(mock.actx, FRAME_MS);
  });
}

/** One slot: the target a timeline moves. */
const slots = { it: type<Target>() };

/** The nested part: a sequence of one tween of `y`. */
const lift = defineAnimation("perf.lift", {
  slots,
  build: ({ it }) => sequence(tween(it, Transform, { y: 40 }, { ms: TWEEN_MS, ease: "out" }))
});

/** The texture keys of the looping frames step. */
const FLIPBOOK = ["perf.f0", "perf.f1", "perf.f2", "perf.f3"];

/** The played animation: a tween of `x`, the nested lift, a looping flipbook and a wait, in parallel. */
const fly = defineAnimation("perf.fly", {
  slots,
  build: ({ it }) =>
    parallel(
      tween(it, Transform, { x: 200 }, { ms: TWEEN_MS, ease: "inOut" }),
      use(lift, { it }),
      frames(it, { keys: FLIPBOOK, fps: 12, loop: true }),
      wait(FOREVER_MS)
    )
});

/** An animation that only waits, in a sequence and beside another wait. */
const pause = defineAnimation("perf.pause", {
  slots,
  build: () => parallel(sequence(wait(FOREVER_MS)), wait(FOREVER_MS))
});

/**
 * Plays one animation ten times, each over the entity a projection key names, as a game aims them.
 *
 * @param animation - The animation to play.
 * @returns One frame step of the timelines.
 */
function playTen(animation: typeof fly): () => void {
  const mock = createMockAnim();
  const rt = createRuntime(mock.actx);

  for (let index = 0; index < TIMELINES; index++) {
    const entity = spawnTestEntity(mock, [
      Transform({ x: index, y: index }),
      Sprite({ texture: "perf.f0" })
    ]);
    const key = `item${index}`;

    mock.world.projection.registerKey("perf", key, entity);
    mock.api.play(animation, { it: { projection: "perf", key } });
  }

  return warmed((): void => {
    beginFrame(mock.actx);
    advanceTimelines(mock.actx, rt, FRAME_MS);
  });
}

/**
 * Ten timelines running: a tween, a nested `use` with its own tween, a looping flipbook and a
 * wait, side by side. Every frame moves 20 fields.
 *
 * @returns One frame step of the timelines.
 */
export function timelinesFixture(): () => void {
  return playTen(fly);
}

/**
 * Ten timelines that only wait: every frame walks every tree and writes nothing.
 *
 * @returns One frame step of the timelines.
 */
export function waitingTimelinesFixture(): () => void {
  return playTen(pause);
}

/** A bounce that moves every frame: up 7.5 and back with a breath of the scale, as offsets. */
const BOUNCE = [
  { at: 0.5, to: { y: -7.5, scale: 0.05 } },
  { at: 1, to: { y: 0, scale: 0 } }
];

/** The pause of a bounce: offsets that stand at 0 for the whole run, as a chest between two hops. */
const PAUSE = [{ at: 1, to: { y: 0, scale: 0 } }];

/**
 * An endless additive bounce of `y` and `scale` over the given segments, as a system plays it.
 *
 * @param id - Animation id.
 * @param segments - The segments of one run.
 * @returns The animation.
 */
function bounceOf(id: string, segments: typeof BOUNCE) {
  return defineAnimation(id, {
    slots,
    build: ({ it }) =>
      tween(
        it,
        Transform,
        { y: 0, scale: 0 },
        { ms: 1000, ease: "inOut", additive: true, repeat: "forever", segments }
      )
  });
}

/** Every view is seen: the loops write. */
function seen(): boolean {
  return false;
}

/** No view is seen: an overlay covers them all. */
function unseen(): boolean {
  return true;
}

/**
 * Starts the mock world and plays an endless bounce ten times through the `AnimPlayer` resource,
 * each on its own entity, as a system starts a chest's bounce once.
 *
 * @param segments - The segments of the bounce.
 * @param held - The answer of `renderer.sync.loopsHeld` for every view.
 * @returns One frame step of the timelines.
 */
function bounceTen(segments: typeof BOUNCE, held: () => boolean): () => void {
  const mock = createMockAnim();

  mock.start();
  // The stand-in renderer of the mock records every ask; the fixture answers without a record.
  mock.state.loopsHeld = held;

  const rt = createRuntime(mock.actx);
  const bounce = bounceOf("perf.bounce", segments);

  for (let index = 0; index < TIMELINES; index++) {
    const entity = spawnTestEntity(mock, [Transform({ x: index, y: index })]);

    mock.world.ecs.resource(AnimPlayer).play(bounce, { it: entity });
  }

  return warmed((): void => {
    beginFrame(mock.actx);
    advanceTimelines(mock.actx, rt, FRAME_MS);
  });
}

/**
 * Ten endless bounces a system played, every frame moving `y` and `scale` of each: 20 fields.
 *
 * @returns One frame step of the timelines.
 */
export function bouncesFixture(): () => void {
  return bounceTen(BOUNCE, seen);
}

/**
 * Ten endless bounces in their pause: every frame walks every track and writes nothing.
 *
 * @returns One frame step of the timelines.
 */
export function restingBouncesFixture(): () => void {
  return bounceTen(PAUSE, seen);
}

/**
 * Ten endless bounces of views nobody sees: every frame asks the renderer and writes nothing.
 *
 * @returns One frame step of the timelines.
 */
export function heldBouncesFixture(): () => void {
  return bounceTen(BOUNCE, unseen);
}

/** How far the time of the easing fixture moves per call: no round step, so it visits every interval. */
const TIME_STEP = 0.000_37;

/**
 * Eases a time that walks over 0 to 1 again and again on a curve made by `cubicBezier`, the way a
 * track's frame step eases it: through `easeCell`, the result in a cell.
 *
 * @param points - The control points `[x1, y1, x2, y2]`.
 * @returns One eased time.
 */
export function bezierFixture(points: readonly [number, number, number, number]): () => void {
  const ease = cubicBezier(...points);
  // [0]: the cell eased in place; [1]: the time, kept in a cell so it never boxes.
  const cells = new Float64Array(2);

  return warmed((): void => {
    const time = (cells[1] ?? 0) + TIME_STEP;

    cells[1] = time >= 1 ? time - 1 : time;
    cells[0] = cells[1] ?? 0;
    easeCell(ease, cells, 0);
  });
}
