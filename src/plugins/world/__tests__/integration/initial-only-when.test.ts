import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineGame,
  exit,
  Now,
  projection,
  rendererPlugin,
  system,
  Transform,
  type,
  worldPlugin
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { component } from "../../ecs/define";

// ---------------------------------------------------------------------------
// Integration: F159, the stopwatch of "A Memory Missing". One projection draws a bolt and a hand.
// The enter motion turns both in from a quarter turn and tweens them home; the system
// `board.hand` writes the hand's rotation from `Now` in phase `input` of every frame. With
// `initialOnly: [[Transform, ["rotation"], part => part.role === "restHand"]]` the hand keeps the
// system's angle through the enter, a lift and the way home, with no correction, and the bolt still
// ends at its rest rotation. The real time, lifecycle, model, clock, flow, world, renderer and anim
// plugins, on a fake clock.
// ---------------------------------------------------------------------------

type Part = { id: string; role: "bolt" | "restHand"; x: number; startedAt: number };
type Player = { parts: Part[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** How long the parts turn in. */
const ENTER_MS = 200;

/** Where the enter motion starts the rotation: a quarter turn off. */
const QUARTER = Math.PI / 2;

/** The rest rotation `view` gives every part. */
const REST = 0;

/** The hand of the stopwatch: when it started. The system turns it from `Now`. */
const Hand = component("Hand", { startedAt: 0 });

/** The angle of the hand at one moment: one radian a second since it started. */
const angleAt = (startedAt: number, now: number): number => (now - startedAt) / 1000;

const stopwatch = projection({
  name: "board.stopwatch",
  layer: "marks",
  lift: "lifted",
  from: (player: Player) => player.parts,
  key: part => part.id,
  view: part =>
    part.role === "restHand"
      ? [Transform({ x: part.x, rotation: REST }), Hand({ startedAt: part.startedAt })]
      : [Transform({ x: part.x, rotation: REST })],
  motion: {
    enter: view => {
      view.set(Transform, { rotation: QUARTER });

      return view.toRest(Transform, { ms: ENTER_MS, ease: "linear" });
    },
    // The way home is a motion too: its end is checked against the rest pose.
    settle: view => view.toRest(Transform, { ms: ENTER_MS, ease: "linear" })
  },
  initialOnly: [[Transform, ["rotation"], part => part.role === "restHand"]]
});

const hands = system({
  name: "board.hand",
  phase: "input",
  query: [Hand, Transform],
  run: (entities, { world, res }) => {
    const { now } = res(Now);

    for (const [entity, hand] of entities) {
      world.set(entity, Transform, { rotation: angleAt(hand.startedAt, now) });
    }
  }
});

const home = defineNode({ rest: true, checkpoint: true, outcomes: { open: type(), quit: type() } });

const open = defineNode({
  outcomes: { done: type() },
  run: ({ player, now, out }) => {
    player.parts = [
      { id: "bolt", role: "bolt", x: 0, startedAt: now },
      { id: "hand", role: "restHand", x: 0, startedAt: now }
    ];

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, open },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { open: "open", quit: exit("over") }, open: { done: "home" } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [Hand],
  systems: [hands],
  projections: [stopwatch]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** The started stopwatch app: the fake clock, and when the parts were opened. */
type Stopwatch = Awaited<ReturnType<typeof openStopwatch>>;

/**
 * Starts the app, mounts the stopwatch and opens it through the graph: the next frame plays the
 * enter of both parts.
 *
 * @returns The app, its clock and the time the parts started at.
 */
async function openStopwatch() {
  const clock = fakeClock(1_790_000_000_000);
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      clock: { source: clock },
      flow: { mainFlow: main, safeNode: "home" },
      model: { initialPlayer: { parts: [] }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([
    { name: "marks", sort: "none" },
    { name: "lifted", sort: "none" }
  ]);
  app.world.projection.mount(["board.stopwatch"], { kind: "plugin", name: "test" });
  // The load of the start is reconciled here, so the commit of `open` plays its motions.
  app.time.step(16);

  const startedAt = clock.now();

  expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
  await tick();

  return { app, clock, startedAt };
}

/**
 * The entity of one part.
 *
 * @param watch - The started stopwatch.
 * @param id - The key.
 * @returns The entity.
 */
function entityOf(watch: Stopwatch, id: string): number {
  return watch.app.world.projection.entityOf("board.stopwatch", id) ?? 0;
}

/**
 * The stored transform of one part.
 *
 * @param watch - The started stopwatch.
 * @param id - The key.
 * @returns The stored value.
 */
function transformOf(watch: Stopwatch, id: string) {
  return watch.app.world.ecs.get(entityOf(watch, id), Transform);
}

/**
 * Steps 16 ms frames, recording after each the rotation the hand shows and the angle the system
 * drew for that moment.
 *
 * @param watch - The started stopwatch.
 * @param count - How many frames.
 * @param seen - The lists the frames fill.
 * @param seen.shown - The hand's rotation after each frame.
 * @param seen.drawn - The system's angle for each frame.
 */
function frames(watch: Stopwatch, count: number, seen: { shown: number[]; drawn: number[] }): void {
  for (let frame = 0; frame < count; frame += 1) {
    watch.clock.advance(16);
    watch.app.time.step(16);
    seen.shown.push(transformOf(watch, "hand")?.rotation ?? -1);
    seen.drawn.push(angleAt(watch.startedAt, watch.clock.now()));
  }
}

/**
 * Counts the `world:view-corrected` entries of the log trace.
 *
 * @param watch - The started stopwatch.
 * @returns How many corrections were logged.
 */
function corrections(watch: Stopwatch): number {
  return watch.app.log.trace().filter(entry => entry.event === "world:view-corrected").length;
}

describe("world — initialOnly with when, the stopwatch of F159", () => {
  // Bug: the pair covers the bolt too, so its enter never brings it home; or it covers neither,
  // so the end of the enter, a lift or the way home writes the hand back to its rest rotation and
  // warns `world:view-corrected`.
  it("keeps the hand on the system's angle and brings the bolt home", async () => {
    const watch = await openStopwatch();
    const projection = watch.app.world.projection;
    const seen = { shown: [] as number[], drawn: [] as number[] };

    // The enter, half way: the bolt turns in, the hand stands where the system put it.
    frames(watch, 6, seen);

    expect(projection.causeOf(entityOf(watch, "bolt"))).toBe("change");
    expect(transformOf(watch, "bolt")?.rotation).toBeGreaterThan(REST);

    // The rest of the enter, a lift and its drop, then the way home of both.
    frames(watch, 14, seen);
    projection.lift(entityOf(watch, "hand"), true);
    projection.lift(entityOf(watch, "bolt"), true);
    frames(watch, 4, seen);
    projection.lift(entityOf(watch, "hand"), false);
    projection.lift(entityOf(watch, "bolt"), false);
    projection.settle(entityOf(watch, "hand"));
    projection.settle(entityOf(watch, "bolt"));
    frames(watch, 20, seen);

    expect(seen.shown).toEqual(seen.drawn);
    expect(transformOf(watch, "bolt")?.rotation).toBe(REST);
    expect(corrections(watch)).toBe(0);

    await watch.app.stop();
  });

  // Bug: the release of a drag's mute reads the spec's seed, not the hand's: it hands the rotation
  // back too, and the way home turns the hand to its rest rotation and warns `world:view-corrected`;
  // or it keeps x, y and scale muted, and the hand never comes home.
  it("hands x, y and scale back after a drag's mute, and keeps the hand's rotation the system's", async () => {
    const watch = await openStopwatch();
    const projection = watch.app.world.projection;
    const seen = { shown: [] as number[], drawn: [] as number[] };

    // The enter ends, then a drag takes the whole transform and moves the hand.
    frames(watch, 20, seen);

    const hand = entityOf(watch, "hand");
    const rest = projection.restOf(hand, Transform);

    expect(rest).toMatchObject({ x: 0, rotation: REST });

    const release = projection.mute(hand, Transform, ["x", "y", "rotation", "scale"]);

    watch.app.world.ecs.set(hand, Transform, { x: 40, y: 12, scale: 1.5 });
    frames(watch, 4, seen);

    expect(transformOf(watch, "hand")).toMatchObject({ x: 40, y: 12, scale: 1.5 });

    // The drop: the mute goes, the way home plays.
    release();
    projection.settle(hand);
    frames(watch, 20, seen);

    expect(transformOf(watch, "hand")).toMatchObject({
      x: rest?.x,
      y: rest?.y,
      scale: rest?.scale
    });
    expect(seen.shown).toEqual(seen.drawn);
    expect(corrections(watch)).toBe(0);

    await watch.app.stop();
  });
});
