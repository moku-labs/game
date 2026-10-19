import { afterEach, describe, expect, it, vi } from "vitest";
import { stepEntry } from "../../../../visual/steps";
import { commands } from "../../../flow/doors/commands";
import { read } from "../../../flow/doors/read";
import { run } from "../../../flow/doors/run";
import { sources } from "../../../flow/doors/sources";
import { Pointer, Pressed, Scrollable } from "../../../input/components";
import { Transform } from "../../../renderer/components";
import { system } from "../../../world/ecs/define";
import { Box, Scroll, ScrollState } from "../../components";
import {
  contentOf,
  FREE_TRACK,
  find,
  frames,
  logged,
  mount,
  moveTo,
  OPEN,
  PINNED,
  poseOf,
  press,
  ROW,
  release,
  type ScrollApp,
  startScrollApp,
  stateOf,
  TRACK,
  WINDOW
} from "../scroll-app";

// ---------------------------------------------------------------------------
// Integration: the scroll tag on both axes (change 2026-10-19-horizontal-scroll,
// S1–S9): the finger, the fling, the snap glide, the offset prop, the range a
// solve gives, the hard edges, ScrollState, app.ui.scroll and game.scroll.
// Real world, real Yoga, plain Bun, inert renderer; a finger lands the way
// `input` lands it, `Pressed` and the `Pointer` resource.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: ScrollApp | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture, mounts one screen and keeps the app for the teardown.
 *
 * @param screen - The projection to mount.
 * @returns The app.
 */
async function start(screen: string): Promise<ScrollApp> {
  running = await startScrollApp();
  mount(running, screen);

  return running;
}

/**
 * Taps a local-state button and lets its component render again.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tapLocal(app: ScrollApp, key: string): void {
  app.input.tap(find(app, key));
  frames(app, 1);
}

/**
 * Holds the finger still for three frames: 48 ms, 64 by the release frame, more than the 50 ms
 * after which a release carries no velocity.
 *
 * @param app - The running app.
 */
function rest(app: ScrollApp): void {
  frames(app, 3);
}

/**
 * Where a glide stands after some ms: the eased way from `from` to `to`, as the strip draws it.
 *
 * @param from - Where it starts.
 * @param to - Where it ends.
 * @param ms - The ms gone.
 * @returns The offset, in whole units.
 */
function glidedTo(from: number, to: number, ms: number): number {
  const duration = Math.min(620, 260 + Math.abs(to - from) * 1.1);
  const left = 1 - ms / duration;

  return Math.round(from + (to - from) * (1 - left * left * left));
}

describe("S1: the finger", () => {
  it("moves an x scroll with the finger along x, ignores y, and stops at 0 and at the end", async () => {
    // Bug caught: the strip follows the finger's y, or runs past one of its edges.
    const app = await start("free");
    const max = FREE_TRACK - PINNED;

    press(app, "free", 500, 900);
    moveTo(app, 400, 1300);

    expect(stateOf(app, "free")).toEqual({ offset: 100, max, moving: true });
    expect(poseOf(app, "free")).toMatchObject({ x: -100, y: 0 });

    moveTo(app, 900, 900);

    expect(stateOf(app, "free")?.offset).toBe(0);

    moveTo(app, -5000, 900);

    expect(stateOf(app, "free")?.offset).toBe(max);
    expect(poseOf(app, "free")?.x).toBe(-max);
    expect(app.world.ecs.get(find(app, "free"), Scroll)).toEqual({
      axis: "x",
      offset: -max,
      min: -max
    });
  });
});

describe("S2, S3: the release", () => {
  it("keeps a quick release moving, slower each frame, until it stops on its own", async () => {
    // Bug caught: a flick stops dead at the release, or flings on at the same speed for ever.
    const app = await start("free");

    press(app, "free", 500, 900);
    moveTo(app, 460, 900);
    moveTo(app, 420, 900);
    moveTo(app, 380, 900);
    release(app, "free");

    const offsets = [stateOf(app, "free")?.offset ?? 0];

    for (let frame = 0; frame < 10; frame += 1) {
      frames(app, 1);
      offsets.push(stateOf(app, "free")?.offset ?? 0);
    }

    const steps = offsets.slice(1).map((offset, index) => offset - (offsets[index] ?? 0));

    // 2.5 u a ms at the release: the release frame itself moves 40 u.
    expect(offsets[0]).toBe(160);
    expect(steps.every(step => step > 0)).toBe(true);
    expect(steps.at(-1)).toBeLessThan(steps[0] ?? 0);
    expect(stateOf(app, "free")?.moving).toBe(true);

    frames(app, 200);

    const stopped = stateOf(app, "free");

    expect(stopped?.moving).toBe(false);
    expect(stopped?.offset).toBeLessThan(FREE_TRACK - PINNED);

    frames(app, 10);

    expect(stateOf(app, "free")).toEqual(stopped);
  });

  it("takes the release velocity from the samples of the last 100 ms only", async () => {
    // Bug caught: the slow start of a drag, still in the ring, drags the flick of its end down.
    const app = await start("free");
    const pointer = (x: number): void => {
      app.world.ecs.resource(Pointer).x = x;
      app.time.step(40);
    };

    // Frames of 40 ms: the finger rests 80 ms, then moves 100 u a frame for two frames.
    app.world.ecs.resource(Pointer).y = 900;
    app.world.ecs.tag(find(app, "free"), Pressed);
    pointer(500);
    pointer(500);
    pointer(500);
    pointer(400);
    pointer(300);
    app.world.ecs.untag(find(app, "free"), Pressed);
    app.time.step(40);

    // 2.5 u a ms from the last two samples; all five would give 1.25 and stop at 250.
    expect(stateOf(app, "free")).toMatchObject({ offset: 300, moving: true });
  });

  it("stops a release at once when the finger rested before it lifted", async () => {
    // Bug caught: the samples from before the rest fling the strip after the finger stood still.
    const app = await start("free");

    press(app, "free", 500, 900);
    moveTo(app, 450, 900);
    moveTo(app, 400, 900);
    rest(app);
    release(app, "free");

    expect(stateOf(app, "free")).toEqual({ offset: 100, max: FREE_TRACK - PINNED, moving: false });

    frames(app, 10);

    expect(stateOf(app, "free")?.offset).toBe(100);
  });

  it("ends a fling on the edge it reaches", async () => {
    // Bug caught: the fling runs past the end, or goes on pushing against it.
    const app = await start("free");
    const max = FREE_TRACK - PINNED;

    expect(app.ui.scroll("free", 2600)).toBe(true);

    press(app, "free", 500, 900);
    moveTo(app, 460, 900);
    moveTo(app, 420, 900);
    release(app, "free");

    expect(stateOf(app, "free")).toEqual({ offset: max, max, moving: false });
    expect(poseOf(app, "free")?.x).toBe(-max);
  });

  it("moves a fling by the frame's scaled time: a time scale of 0 holds it", async () => {
    // Bug caught: the fling runs on the wall clock, so a paused or slowed game scrolls on.
    const app = await start("free");

    press(app, "free", 500, 900);
    moveTo(app, 460, 900);
    moveTo(app, 420, 900);
    release(app, "free");

    const flung = stateOf(app, "free")?.offset;

    app.time.setScale(0);
    frames(app, 5);

    expect(stateOf(app, "free")).toMatchObject({ offset: flung, moving: true });

    app.time.setScale(1);
    frames(app, 1);

    expect(stateOf(app, "free")?.offset).toBeGreaterThan(flung ?? 0);
  });
});

describe("S4: snap", () => {
  it("glides a flick toward 0 near 318 to the stop 0, on the curve and in the time of a glide", async () => {
    // Bug caught: the release takes the stop nearest to where the finger let go (318), not the
    // one its velocity carries it to, or glides on another curve or for another time.
    const app = await start("strip");

    expect(stateOf(app, "strip")?.offset).toBe(318);

    press(app, "strip", 500, 900);
    moveTo(app, 520, 900);
    moveTo(app, 540, 900);

    // 278, moving toward 0 at 1.25 u a ms: it carries to -47, nearest to the stop 0.
    expect(stateOf(app, "strip")?.offset).toBe(278);

    release(app, "strip");

    expect(stateOf(app, "strip")).toEqual({ offset: glidedTo(278, 0, 16), max: 390, moving: true });

    frames(app, 9);

    expect(stateOf(app, "strip")?.offset).toBe(glidedTo(278, 0, 160));

    frames(app, 30);

    expect(stateOf(app, "strip")).toEqual({ offset: 0, max: 390, moving: false });
    expect(poseOf(app, "strip")?.x).toBe(0);
  });

  it("stops a glide where it stands when a finger lands on it", async () => {
    // Bug caught: the glide goes on under the finger, or the finger snaps the strip back to where
    // the glide began.
    const app = await start("strip");

    tapLocal(app, "toEvents");
    frames(app, 5);

    const caught = stateOf(app, "strip")?.offset ?? 0;

    expect(caught).toBeLessThan(318);
    expect(caught).toBeGreaterThan(0);

    press(app, "strip", 500, 900);

    expect(stateOf(app, "strip")).toEqual({ offset: caught, max: 390, moving: true });

    frames(app, 5);

    expect(stateOf(app, "strip")?.offset).toBe(caught);
  });
});

describe("S5: the offset prop", () => {
  it("draws the strip at its offset prop in the first frame it is drawn", async () => {
    // Bug caught: the strip is drawn at 0 for a frame, then jumps to 318.
    running = await startScrollApp();

    const app = running;
    const drawn: number[] = [];

    app.world.ecs.system(
      system({
        name: "test.firstDraw",
        phase: "sync",
        query: [],
        run: () => {
          const strip = app.ui.find("strip");
          const pose =
            strip === undefined ? undefined : app.world.ecs.get(contentOf(app, strip), Transform);

          if (pose !== undefined) drawn.push(pose.x);
        }
      })
    );
    app.world.projection.mount(["strip"], { kind: "plugin", name: "test" });
    frames(app, 3);

    expect(drawn[0]).toBe(-318);
    expect(stateOf(app, "strip")).toEqual({ offset: 318, max: 390, moving: false });
  });

  it("glides to a new offset prop", async () => {
    // Bug caught: a new offset prop jumps there at once, or is never followed.
    const app = await start("strip");

    tapLocal(app, "toEvents");

    expect(stateOf(app, "strip")).toEqual({ offset: 318, max: 390, moving: true });

    frames(app, 1);

    expect(stateOf(app, "strip")?.offset).toBe(glidedTo(318, 0, 16));

    frames(app, 40);

    expect(stateOf(app, "strip")).toEqual({ offset: 0, max: 390, moving: false });
  });

  it("leaves a strip the finger holds with the finger when a render brings a new offset prop", async () => {
    // Bug caught: a render pulls the strip out from under the finger into a glide.
    const app = await start("strip");

    press(app, "strip", 500, 900);
    tapLocal(app, "toEvents");

    expect(stateOf(app, "strip")).toEqual({ offset: 318, max: 390, moving: true });

    moveTo(app, 480, 900);

    expect(stateOf(app, "strip")?.offset).toBe(338);
  });

  it("keeps a strip the finger moved when a render repeats the offset prop and restyles it", async () => {
    // Bug caught: a render that says offset={318} again pulls the strip the player dragged to the
    // end back to 318, or a restyle patches where the strip stands.
    const app = await start("strip");

    press(app, "strip", 500, 900);
    moveTo(app, 440, 900);
    rest(app);
    release(app, "strip");
    frames(app, 30);

    expect(stateOf(app, "strip")).toEqual({ offset: 390, max: 390, moving: false });

    tapLocal(app, "restyle");
    frames(app, 2);

    expect(app.world.ecs.get(find(app, "strip"), Box)?.h).toBe(140);
    expect(stateOf(app, "strip")).toEqual({ offset: 390, max: 390, moving: false });
    expect(app.world.ecs.get(find(app, "strip"), Scrollable)).toEqual({ axis: "x", moving: false });
    expect(poseOf(app, "strip")?.x).toBe(-390);
  });
});

describe("S6: the range", () => {
  it("stands on 306 when the pinned column closes: the window, the stops and the offset change in one render", async () => {
    // Bug caught: the strip glides to 318 past its new end, or comes to rest anywhere but 306.
    const app = await start("strip");

    tapLocal(app, "unpin");

    expect(app.world.ecs.get(find(app, "strip"), Box)?.w).toBe(OPEN);
    expect(stateOf(app, "strip")).toEqual({ offset: 306, max: 306, moving: false });
    expect(poseOf(app, "strip")?.x).toBe(-306);

    frames(app, 40);

    expect(stateOf(app, "strip")).toEqual({ offset: 306, max: 306, moving: false });
  });

  it("clamps an offset past a new end in the frame the range shrinks", async () => {
    // Bug caught: the strip shows empty space past its end until something moves it.
    const app = await start("strip");

    app.ui.scroll("strip", 390);
    tapLocal(app, "widen");

    expect(stateOf(app, "strip")).toEqual({ offset: 306, max: 306, moving: false });
    expect(poseOf(app, "strip")?.x).toBe(-306);
  });

  it("ends a running glide on the new end when the range shrinks under its target", async () => {
    // Bug caught: the glide goes on to its old target, past the new end.
    const app = await start("strip");

    // A slow release at 378 glides to the stop 390.
    press(app, "strip", 500, 900);
    moveTo(app, 440, 900);
    rest(app);
    release(app, "strip");

    expect(stateOf(app, "strip")?.moving).toBe(true);

    tapLocal(app, "widen");

    for (let frame = 0; frame < 20; frame += 1) {
      frames(app, 1);

      expect(stateOf(app, "strip")?.offset).toBeLessThanOrEqual(306);
    }

    expect(stateOf(app, "strip")).toEqual({ offset: 306, max: 306, moving: false });
  });
});

describe("S7: hard edges", () => {
  it("moves only the x scroll a finger drags along x past its end inside a y scroll", async () => {
    // Bug caught: the move a scroll at its edge cannot take passes on to the list around it.
    const app = await start("nested");

    press(app, "shelf", 200, 60);
    moveTo(app, -600, 90);
    moveTo(app, -900, 140);

    expect(stateOf(app, "shelf")?.offset).toBe(TRACK - PINNED);
    expect(stateOf(app, "page")).toEqual({ offset: 0, max: 120 + 20 * ROW - 600, moving: false });
    expect(poseOf(app, "page")?.y).toBe(0);
    expect(app.world.ecs.has(find(app, "page"), Pressed)).toBe(false);
  });
});

describe("S8: ScrollState", () => {
  it("writes ScrollState in a frame its offset or moving changed, once when it stops, never while it stands", async () => {
    // Bug caught: ScrollState is written every frame, so a system that reads its changes works for
    // nothing, or never says the scroll stopped.
    const app = await start("free");
    const set = vi.spyOn(app.world.ecs, "set");
    const writes = (type: object): number => set.mock.calls.filter(call => call[1] === type).length;

    press(app, "free", 500, 900);
    moveTo(app, 460, 900);
    moveTo(app, 420, 900);
    release(app, "free");

    expect(writes(Scrollable)).toBe(1);

    for (let frame = 0; frame < 300 && stateOf(app, "free")?.moving === true; frame += 1) {
      const before = { ...stateOf(app, "free") };
      const count = writes(ScrollState);

      frames(app, 1);

      const changed =
        before.offset !== stateOf(app, "free")?.offset ||
        before.moving !== stateOf(app, "free")?.moving;

      expect(writes(ScrollState) - count).toBe(changed ? 1 : 0);
    }

    expect(stateOf(app, "free")?.moving).toBe(false);
    expect(writes(Scrollable)).toBe(2);
    expect(app.world.ecs.get(find(app, "free"), Scrollable)).toEqual({ axis: "x", moving: false });

    const still = writes(ScrollState);

    frames(app, 10);

    expect(writes(ScrollState)).toBe(still);
  });

  it("shows ScrollState among the components the read door explains for the scroll's entity", async () => {
    // Bug caught: ScrollState holds something the snapshot skips, so `moku_read` never sees it.
    const app = await start("strip");
    const explained = read(app, sources.explain, { entity: find(app, "strip") });

    expect(explained?.components.ScrollState).toEqual({ offset: 318, max: 390, moving: false });
  });
});

describe("S9: the vertical lists", () => {
  it("flings a vertical list after a quick release", async () => {
    // Bug caught: only an x scroll flings.
    const app = await start("list");

    press(app, "list", 200, 1000);
    moveTo(app, 200, 960);
    moveTo(app, 200, 920);
    moveTo(app, 200, 880);
    release(app, "list");
    frames(app, 5);

    expect(stateOf(app, "list")).toMatchObject({ moving: true, max: 30 * ROW - 200 });
    expect(stateOf(app, "list")?.offset).toBeGreaterThan(160);
    expect(poseOf(app, "list")?.y).toBe(-(stateOf(app, "list")?.offset ?? 0));
  });

  it("flings a windowed list and cuts its rows at the offset the fling reaches", async () => {
    // Bug caught: a windowed list flings past the rows its window holds, which run out.
    const app = await start("rows");

    press(app, "rows", 500, 1500);
    moveTo(app, 500, 1420);
    moveTo(app, 500, 1340);
    moveTo(app, 500, 1260);
    release(app, "rows");
    frames(app, 20);

    const offset = stateOf(app, "rows")?.offset ?? 0;
    const lastShown = Math.ceil((offset + WINDOW) / ROW) - 1;

    expect(offset).toBeGreaterThan(1000);
    expect(app.world.ecs.get(find(app, "rows"), Scroll)?.offset).toBe(-offset);
    expect(app.ui.find(`r${lastShown}`)).toBeDefined();
    expect(app.ui.find("r0")).toBeUndefined();
  });

  it("throws for a windowed scroll on the x axis, and its root fails alone", async () => {
    // Bug caught: a windowed list on x mounts and cuts rows along the wrong axis.
    const app = await start("sideRows");
    const [failed] = logged(app, "ui:root-failed") as { error?: { message?: string } }[];

    expect(app.ui.find("sideRows")).toBeUndefined();
    expect(failed?.error?.message).toBe(
      '[game] A windowed scroll moves on y only.\n  Drop axis "x" or use the children form.'
    );
  });

  it("keeps the axis a scroll spawned with and warns once when a render changes it", async () => {
    // Bug caught: a render that flips the axis turns a live strip into a list half way.
    const app = await start("turn");

    tapLocal(app, "turn");
    tapLocal(app, "nudge");

    expect(app.world.ecs.get(find(app, "turning"), Box)?.h).toBe(140);
    expect(app.world.ecs.get(find(app, "turning"), Scroll)?.axis).toBe("x");
    expect(app.world.ecs.get(find(app, "turning"), Scrollable)?.axis).toBe("x");
    expect(stateOf(app, "turning")?.max).toBe(TRACK - PINNED);
    expect(logged(app, "ui:scroll-axis-fixed")).toEqual([{ key: "turning", axis: "x" }]);
  });
});

describe("app.ui.scroll and game.scroll", () => {
  it("puts a scroll at an offset at once, inside its range, and stops its glide", async () => {
    // Bug caught: the glide resumes after the jump, or the offset passes the end.
    const app = await start("strip");

    tapLocal(app, "toEvents");

    expect(stateOf(app, "strip")?.moving).toBe(true);
    expect(app.ui.scroll("strip", 999)).toBe(true);
    expect(stateOf(app, "strip")).toEqual({ offset: 390, max: 390, moving: false });
    expect(poseOf(app, "strip")?.x).toBe(-390);

    frames(app, 5);

    expect(stateOf(app, "strip")).toEqual({ offset: 390, max: 390, moving: false });
    expect(app.ui.scroll("strip", 0)).toBe(true);
    expect(stateOf(app, "strip")).toEqual({ offset: 0, max: 390, moving: false });
    // NaN is no offset: the strip stays where it stands.
    expect(app.ui.scroll("strip", Number.NaN)).toBe(true);
    expect(stateOf(app, "strip")).toEqual({ offset: 0, max: 390, moving: false });
  });

  it("answers false with one warning for a key that names no live scroll", async () => {
    // Bug caught: a key of another element, or of nothing, is scrolled or throws.
    const app = await start("strip");

    expect(app.ui.scroll("nothing", 0)).toBe(false);
    expect(app.ui.scroll("unpin", 0)).toBe(false);
    expect(logged(app, "ui:scroll-without-scroll")).toEqual([{ key: "nothing" }, { key: "unpin" }]);
    expect(stateOf(app, "strip")?.offset).toBe(318);
  });

  it("runs the visual step { scroll: { key, to } } through the catalogue as app.ui.scroll", async () => {
    // Bug caught: the step is refused by the visual test, or the command reaches no scroll.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const app = await start("strip");
    const entry = stepEntry("strip-events", { scroll: { key: "strip", to: 0 } }, 0);

    expect(entry).toEqual({ kind: "command", name: "scroll", input: { key: "strip", to: 0 } });

    const ran = await run(app, commands.scroll, { key: "strip", to: 0 });

    expect(ran.value).toBe(true);
    expect(ran.state.tainted).toBe(false);
    expect(stateOf(app, "strip")).toEqual({ offset: 0, max: 390, moving: false });
  });
});
