import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineGame,
  exit,
  Now,
  projection,
  rendererPlugin,
  Shape,
  system,
  type,
  worldPlugin
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { component } from "../../ecs/define";

// ---------------------------------------------------------------------------
// Integration: F91, the timer ring of "A Memory Missing". A projection draws the ring full at its
// birth and fades it in; the system `board.rings` draws the arc from `Now` in phase `input` of
// every frame. With `initialOnly: [[Shape, ["sweep"]]]` the end of the fade corrects nothing, so
// no frame ends with a full ring. The real time, lifecycle, model, clock, flow, world, renderer
// and anim plugins, on a fake clock.
// ---------------------------------------------------------------------------

type Timer = { id: string; startedAt: number; ms: number };
type Player = { timers: Timer[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** How long the timer of the chest runs. */
const TIMER_MS = 1000;

/** How long the ring fades in. */
const FADE_MS = 200;

/** The timer behind a ring: when it started and how long it runs. The system draws the arc from it. */
const TimerRing = component("TimerRing", { startedAt: 0, ms: 0 });

const marks = projection({
  name: "board.marks",
  layer: "marks",
  from: (player: Player) => player.timers,
  key: (found: Timer) => found.id,
  view: (found: Timer) => [
    TimerRing({ startedAt: found.startedAt, ms: found.ms }),
    Shape({ kind: "arc", w: 28, h: 28, strokeWidth: 2, sweep: 1 })
  ],
  motion: {
    enter: view => {
      view.set(Shape, { alpha: 0 });

      return view.tween(Shape, { alpha: 1 }, { ms: FADE_MS, ease: "linear" });
    }
  },
  initialOnly: [[Shape, ["sweep"]]]
});

/** The arc of a ring at one moment: full at the start, empty when the timer ran out. */
const sweepAt = (ring: { startedAt: number; ms: number }, now: number): number =>
  Math.max(0, 1 - (now - ring.startedAt) / ring.ms);

const rings = system({
  name: "board.rings",
  phase: "input",
  query: [TimerRing, Shape],
  run: (entities, { world, res }) => {
    const { now } = res(Now);

    for (const [entity, ring, shape] of entities) {
      const sweep = sweepAt(ring, now);

      if (shape.sweep !== sweep) world.set(entity, Shape, { sweep });
    }
  }
});

const home = defineNode({ rest: true, checkpoint: true, outcomes: { arm: type(), quit: type() } });

const arm = defineNode({
  outcomes: { done: type() },
  run: ({ player, now, out }) => {
    player.timers = [{ id: "chest", startedAt: now, ms: TIMER_MS }];

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, arm },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { arm: "arm", quit: exit("over") }, arm: { done: "home" } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [TimerRing],
  systems: [rings],
  projections: [marks]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

describe("world — initialOnly, the timer ring of F91", () => {
  // Bug: the end of the fade writes the arc back to the full ring the view drew at birth and
  // warns `world:view-corrected`: a full ring flashes over a chest whose time already runs.
  it("keeps the arc the system draws through the end of the fade, with no correction", async () => {
    const clock = fakeClock(1_790_000_000_000);
    const app = createApp({
      plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
      pluginConfigs: {
        clock: { source: clock },
        flow: { mainFlow: main, safeNode: "home" },
        model: { initialPlayer: { timers: [] }, initialSession: {}, seed: 1 }
      }
    });

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();
    app.world.projection.setLayers([{ name: "marks", sort: "none" }]);
    app.world.projection.mount(["board.marks"], { kind: "plugin", name: "test" });
    // The load of the start is reconciled here, so the commit of `arm` plays its motions.
    app.time.step(16);

    const startedAt = clock.now();

    expect(app.flow.gate.answer({ intent: "arm" })).toBe(true);
    await tick();

    const arcs: number[] = [];
    const drawn: number[] = [];

    // The fade and a little after, one 16 ms frame at a time: each frame is what the screen shows.
    for (let frame = 0; frame < 20; frame += 1) {
      clock.advance(16);
      app.time.step(16);

      const ring = app.world.projection.entityOf("board.marks", "chest") ?? 0;

      arcs.push(app.world.ecs.get(ring, Shape)?.sweep ?? -1);
      drawn.push(sweepAt({ startedAt, ms: TIMER_MS }, clock.now()));
    }

    const ring = app.world.projection.entityOf("board.marks", "chest") ?? 0;

    // The ring came with the commit, so it faded in: the fade is what ends with the check.
    expect(app.world.projection.causeOf(ring)).toBe("change");
    expect(app.world.ecs.get(ring, Shape)?.alpha).toBe(1);
    expect(arcs).toEqual(drawn);
    expect(app.log.trace().filter(entry => entry.event === "world:view-corrected")).toEqual([]);

    await app.stop();
  });
});
