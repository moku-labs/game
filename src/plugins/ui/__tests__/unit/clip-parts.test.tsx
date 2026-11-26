import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import {
  type Clip,
  type ClipOptions,
  clipTree,
  ENTER_DY,
  late,
  PAGE_ELEMENTS,
  PITCH,
  page,
  startClip
} from "../clip-app";

// ---------------------------------------------------------------------------
// Unit: a new subtree wholly behind its clip, built in parts inside a live root (spec 33, slice G). A page of 128
// elements mounted at x 456 under a 390-wide `overflow: "hidden"` area enters alone in its commit; its children are
// made over the next frames, at most 48 a frame and under 4 ms of the page clock; the build finishes in one block in
// the frame the page first meets its clip, before the root's next diff, and its held enters play there. Headless, a
// page that is not wholly outside on an axis known from its style, a page whose content is one component, and
// a page under a scroll mount whole, as before.
// ---------------------------------------------------------------------------

const started: Clip[] = [];

afterEach(async () => {
  for (const clip of started.splice(0)) await clip.app.stop();

  late.entity = undefined;
  late.x = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Starts a fixture and stops it after the test. The page clock stands still, so only the cap of a frame cuts a part.
 *
 * @param options - Whether the renderer draws and whether the strip hangs in a scroll.
 * @returns The started fixture.
 */
async function start(options: ClipOptions = {}): Promise<Clip> {
  const clip = await startClip(options);

  started.push(clip);
  vi.spyOn(globalThis.performance, "now").mockReturnValue(0);

  return clip;
}

/** The tree of the strip with page `p1` beside `p0`, one pitch to the right: at x 456 in the 390-wide area. */
const beside = (): ReturnType<typeof clipTree> => clipTree([page("p0", 0), page("p1", PITCH)]);

/**
 * Steps frames and keeps how many elements each one made.
 *
 * @param clip - The started fixture.
 * @param count - How many frames.
 * @returns The elements made in each frame.
 */
function made(clip: Clip, count: number): number[] {
  const out: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const before = clip.nodes();

    clip.frame();
    out.push(clip.nodes() - before);
  }

  return out;
}

/**
 * The keys of every leaf of a page.
 *
 * @param name - The page.
 * @returns Its 119 leaf keys.
 */
function leavesOf(name: string): string[] {
  return Array.from({ length: 7 }, (_row, row) =>
    Array.from({ length: 17 }, (_leaf, leaf) => `${name}Leaf${row}x${leaf}`)
  ).flat();
}

describe("a subtree wholly behind its clip, built in parts (spec 33 G)", () => {
  // Bug: the page beside the one on show is built whole in the peek's commit frame, the 128 elements the player
  // cannot see yet (the A26 peek frame, 50–65 ms).
  it("enters a clipped-out page alone, then makes its children at most 48 a frame until it is whole", async () => {
    const clip = await start();
    const base = clip.nodes();

    clip.render(beside());

    expect(made(clip, 1)).toEqual([1]);
    expect(clip.keyed("p1")).toBeDefined();
    expect(clip.keyed("p1Row0")).toBeUndefined();

    expect(made(clip, 4)).toEqual([48, 48, 31, 0]);
    expect(clip.nodes()).toBe(base + PAGE_ELEMENTS);
    for (const key of leavesOf("p1")) expect(clip.keyed(key)).toBeDefined();
  });

  // Bug: the part frame reads no clock, so a slow phone makes all 48 elements past its 4 ms.
  it("stops a part frame once 4 ms of the page clock went, the clock read every 8 elements", async () => {
    const clip = await start();
    let moment = 0;

    vi.spyOn(globalThis.performance, "now").mockImplementation(() => {
      moment += 1;

      return moment;
    });
    clip.render(beside());
    made(clip, 1);

    expect(made(clip, 1)).toEqual([32]);
  });

  // Bug: the trigger parks a page that is on the screen: the frame draws it half-built.
  it("mounts a page that stands in its clip whole in its commit", async () => {
    const clip = await start();

    clip.render(clipTree([page("p0", 0), page("p1", 0)]));

    expect(made(clip, 1)).toEqual([PAGE_ELEMENTS]);
  });

  // Bug: a page whose width comes from its children is taken as known: its span is a guess, so it may show unbuilt.
  it("mounts a page whose width depends on its children whole", async () => {
    const clip = await start();

    clip.render(clipTree([page("p0", 0), page("p1", PITCH, "fluid")]));

    expect(made(clip, 1)).toEqual([PAGE_ELEMENTS]);
  });

  // Bug: the count goes down a component node: what it finds is not what the view draws, and a view would run out of
  // its turn to say more.
  it("counts a component as one node: a page whose rows are one component mounts whole", async () => {
    const clip = await start();

    clip.render(clipTree([page("p0", 0), page("p1", PITCH, "wrapped")]));

    expect(made(clip, 1)).toEqual([PAGE_ELEMENTS]);
  });

  // Bug: a headless test that commits and reads the tree in one frame finds the page empty. (A fast or paused world
  // runs no phase `layout`, so it reconciles nothing at all: world/ecs/systems.ts, `runPhase`.)
  it("mounts the clipped-out page whole with no drawing renderer", async () => {
    const headless = await start({ drawing: false });

    headless.render(beside());
    expect(made(headless, 1)).toEqual([PAGE_ELEMENTS]);
  });

  // Bug: under a scroll the clip's span moves with the finger in the scroll step: the page would show unbuilt.
  it("mounts a page under a scroll whole", async () => {
    const clip = await start({ scrolled: true });

    clip.render(clipTree([page("p0", 0), page("p1", PITCH)], true));

    expect(made(clip, 1)).toEqual([PAGE_ELEMENTS]);
  });

  // Bug: the pager slides the page in, written in `animate`, and the frame it first shows draws it half-built, or
  // draws a leaf at its rest before its enter starts.
  it("finishes the build in the frame a strip moved in `animate` brings the page into its clip", async () => {
    const clip = await start();
    const strip = clip.keyed("clipStrip") ?? 0;
    const restX = clip.app.world.projection.restOf(strip, Transform)?.x ?? 0;
    const ecs = clip.app.world.ecs;
    const slid = { on: false };
    const drawn: number[] = [];

    clip.app.time.onFrame("animate", () => {
      if (slid.on) ecs.set(strip, Transform, { x: restX - PITCH });
    });
    clip.app.time.onFrame("sync", () => {
      if (!slid.on || drawn.length > 0) return;

      for (const key of leavesOf("p1")) {
        const leaf = clip.keyed(key);
        const now = leaf === undefined ? undefined : ecs.get(leaf, Transform)?.y;
        const rest =
          leaf === undefined ? undefined : clip.app.world.projection.restOf(leaf, Transform)?.y;

        drawn.push(now === undefined || rest === undefined ? Number.NaN : Math.round(now - rest));
      }
    });
    clip.render(beside());
    made(clip, 2);
    slid.on = true;

    expect(made(clip, 1)).toEqual([PAGE_ELEMENTS - 49]);
    expect(drawn).toEqual(leavesOf("p1").map(() => ENTER_DY));
  });

  // Bug: a strip written late, in `sync`, shows the page unbuilt for a frame with no word to the developer.
  it("names a page that first meets its clip in `sync` once in a dev build, and finishes it at the next layout", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const clip = await start();
    const warned: Array<{ event: string; data: unknown }> = [];

    // Spied after the start: the fixture restores every mock once the app runs.
    vi.spyOn(console, "warn").mockImplementation((entry: { event: string; data: unknown }) => {
      warned.push(entry);
    });
    const strip = clip.keyed("clipStrip") ?? 0;
    const restX = clip.app.world.projection.restOf(strip, Transform)?.x ?? 0;
    const lateOnes = (): unknown[] =>
      warned.filter(entry => entry.event === "ui:clip-late").map(entry => entry.data);

    clip.render(beside());
    made(clip, 2);
    late.entity = strip;
    late.x = restX - PITCH;

    expect(made(clip, 1)).toEqual([48]);
    expect(lateOnes()).toEqual([{ key: "p1", root: "clip" }]);

    expect(made(clip, 2)).toEqual([PAGE_ELEMENTS - 97, 0]);
    expect(lateOnes()).toHaveLength(1);
  });

  // Bug: a release build pays for the late check.
  it("runs no late check in a release build", async () => {
    const clip = await start();
    const warned: Array<{ event: string }> = [];

    // Spied after the start: the fixture restores every mock once the app runs.
    vi.spyOn(console, "warn").mockImplementation((entry: { event: string }) => {
      warned.push(entry);
    });
    const strip = clip.keyed("clipStrip") ?? 0;

    clip.render(beside());
    made(clip, 2);
    late.entity = strip;
    late.x = (clip.app.world.projection.restOf(strip, Transform)?.x ?? 0) - PITCH;
    made(clip, 3);

    expect(warned.filter(entry => entry.event === "ui:clip-late")).toEqual([]);
  });

  // Bug: a commit during the build diffs the root against the parked nodes too: an element is made twice.
  it("finishes the build before a commit diffs the root: one diff, no element twice", async () => {
    const whole = await start({ drawing: false });
    const clip = await start();
    const warned: Array<{ event: string }> = [];

    // Spied after the start: the fixture restores every mock once the app runs.
    vi.spyOn(console, "warn").mockImplementation((entry: { event: string }) => {
      warned.push(entry);
    });
    const base = clip.nodes();

    for (const run of [clip, whole]) {
      run.render(beside());
      made(run, 2);
      run.render(beside());
    }

    expect(made(clip, 2)).toEqual([PAGE_ELEMENTS - 49, 0]);
    made(whole, 2);
    expect(clip.nodes()).toBe(base + PAGE_ELEMENTS);
    expect(warned.filter(entry => entry.event === "ui:duplicate-key")).toEqual([]);
    // One child list each: the tree is the one a whole mount of the same commits builds.
    expect(clip.app.ui.tree()).toEqual(whole.app.ui.tree());
  });

  // Bug: a page that leaves during its build keeps its parts queued: the next frames make elements under nothing.
  it("forgets the parts of a page that leaves during its build", async () => {
    const clip = await start();
    const base = clip.nodes();

    clip.render(beside());
    made(clip, 2);
    clip.render(clipTree([page("p0", 0)]));
    clip.frame();

    expect(clip.nodes()).toBe(base);
    expect(clip.keyed("p1")).toBeUndefined();
    expect(made(clip, 3)).toEqual([0, 0, 0]);
  });

  // Bug: under the on-demand loop nothing else asks for a frame while the page is built: the build stalls.
  it("asks for the next frame from the reconcile while parts are left, and no more once none is", async () => {
    const clip = await start();
    const wake = clip.app.time.wake.bind(clip.app.time);
    const woke = { now: false };
    const seen: boolean[] = [];

    vi.spyOn(clip.app.time, "wake").mockImplementation(() => {
      if (clip.reconciling()) woke.now = true;

      wake();
    });
    clip.render(beside());
    made(clip, 1);

    for (let index = 0; index < 4; index += 1) {
      woke.now = false;
      clip.frame();
      seen.push(woke.now);
    }

    expect(seen).toEqual([true, true, true, false]);
  });
});
