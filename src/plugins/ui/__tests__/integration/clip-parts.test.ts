import { afterEach, describe, expect, it, vi } from "vitest";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import { Box, UiCounters } from "../../components";
import type { UiNode } from "../../jsx/types";
import { ALBUM, albumTree3, PITCH } from "../perf/album";
import { type AlbumPerf, startAlbumPerf } from "../perf/album.fixture";

// ---------------------------------------------------------------------------
// Integration: the album of «A Memory Missing» with both neighbours of the page on show mounted once a turn settles
// (spec 33, slice G). The new neighbour, wholly behind the page area's clip, enters alone in its commit and is built in
// parts over the next frames; a following peek mounts nothing; at the end every element stands and is drawn as after
// a whole mount. The pager's own motion: the strip slid by one pitch over 450 ms, written in `animate`, finishes the
// build at the latest in the frame the page first shows, and every frame of the slide draws it whole once it shows.
// ---------------------------------------------------------------------------

/** The apps of the running test, stopped after it. */
const running: AlbumPerf[] = [];

afterEach(async () => {
  for (const perf of running.splice(0)) await perf.ui.app.stop();

  vi.restoreAllMocks();
});

/** How long the pager slides the strip by one pitch. */
const SLIDE_MS = 450;

/** Frames that bring a commit to rest. */
const SETTLE = 60;

/**
 * Starts the album, its renderer drawing or headless, and turns it to set 1, set 0 on the left, at rest.
 *
 * @param drawing - Whether the renderer answers as one that draws.
 * @returns The started album.
 */
async function turned(drawing: boolean): Promise<AlbumPerf> {
  const perf = await startAlbumPerf({ drawing });

  running.push(perf);
  perf.render(ALBUM.turned[0] ?? ALBUM.first);
  steps(perf, SETTLE);

  return perf;
}

/**
 * Steps whole frames of the app.
 *
 * @param perf - The started album.
 * @param count - How many.
 */
function steps(perf: AlbumPerf, count: number): void {
  for (let index = 0; index < count; index += 1) perf.ui.app.time.step(16);
}

/**
 * How many elements `ui` holds now.
 *
 * @param perf - The started album.
 * @returns Its Yoga nodes.
 */
function nodes(perf: AlbumPerf): number {
  return perf.ui.app.world.ecs.resource(UiCounters).nodes;
}

/**
 * Counts the nodes of a subtree of the screen.
 *
 * @param node - The top.
 * @returns It and everything under it.
 */
function sizeOf(node: UiNode): number {
  let size = 1;

  for (const child of node.children) size += sizeOf(child);

  return size;
}

/**
 * The size of the subtree of a key on the screen.
 *
 * @param node - Where the search starts.
 * @param key - The key.
 * @returns Its size, or 0 when it is not on the screen.
 */
function subtreeOf(node: UiNode, key: string): number {
  if (node.key === key) return sizeOf(node);

  for (const child of node.children) {
    const size = subtreeOf(child, key);

    if (size > 0) return size;
  }

  return 0;
}

/**
 * A number rounded to 0.01.
 *
 * @param value - The number.
 * @returns It, rounded.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every element as it stands and is drawn: its `Box`, its pose and its visual, rounded, in one sorted list, so two
 * apps that built the same screen in another order compare equal.
 *
 * @param perf - The started album.
 * @returns The sorted list.
 */
function drawnElements(perf: AlbumPerf): string[] {
  const ecs = perf.ui.app.world.ecs;
  const out: string[] = [];

  for (const [entity, box] of ecs.query(Box)) {
    const pose = ecs.get(entity, Transform);

    out.push(
      JSON.stringify({
        box: [round(box.x), round(box.y), round(box.w), round(box.h)],
        pose: pose === undefined ? undefined : [round(pose.x), round(pose.y), round(pose.scale)],
        shape: ecs.get(entity, Shape),
        slice: ecs.get(entity, NineSlice),
        sprite: ecs.get(entity, Sprite)
      })
    );
  }

  return out.toSorted();
}

describe("the album's far neighbour, built in parts behind the page area (spec 33 G)", () => {
  // Bug: the neighbour mounted after a turn is built whole in its commit frame, or a later peek mounts it again; or
  // the screen a build in parts ends on is not the one a whole mount ends on.
  it("enters the new neighbour's page alone, finishes it in the next frames, and ends as a whole mount", async () => {
    const parts = await turned(true);
    const whole = await turned(false);

    // The page clock stands still, so only the cap of a frame cuts a part, however loaded the machine is. Spied after
    // both starts: a start restores every mock.
    vi.spyOn(globalThis.performance, "now").mockReturnValue(0);

    for (const perf of [parts, whole]) perf.render(albumTree3(1));

    const before = nodes(parts);

    steps(parts, 1);
    expect(nodes(parts) - before).toBe(1);
    steps(whole, 1);

    steps(parts, 3);
    // Whole: as many nodes on the screen as the page on show, built whole at its own mount.
    expect(subtreeOf(parts.ui.app.ui.tree(), "albumPage2")).toBe(
      subtreeOf(parts.ui.app.ui.tree(), "albumPage1")
    );

    // The peek: a commit of the same strip mounts nothing.
    const built = nodes(parts);

    for (const perf of [parts, whole]) perf.render(albumTree3(1));

    steps(parts, 1);
    expect(nodes(parts)).toBe(built);

    steps(parts, SETTLE);
    steps(whole, SETTLE);
    expect(nodes(parts)).toBe(nodes(whole));
    expect(parts.ui.app.ui.tree()).toEqual(whole.ui.app.ui.tree());
    expect(drawnElements(parts)).toEqual(drawnElements(whole));
  });

  // Bug: the pager slides the strip in `animate` and the frame the page first shows draws it half-built.
  it("draws the page whole in every frame of the pager's slide once it shows", async () => {
    const perf = await turned(true);
    const app = perf.ui.app;
    let moment = 0;

    // Two page-clock milliseconds a read: 16 elements a part frame, so the page still has parts when it shows.
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => {
      moment += 2;

      return moment;
    });

    perf.render(albumTree3(1));

    const before = nodes(perf);

    steps(perf, 1);
    expect(nodes(perf) - before).toBe(1);

    const strip = app.ui.find("albumPages") ?? 0;
    const restX = app.world.projection.restOf(strip, Transform)?.x ?? 0;
    const slide = { ms: 0 };
    const frames: Array<{ shows: boolean; size: number }> = [];

    app.time.onFrame("animate", () => {
      slide.ms += 16;
      app.world.ecs.set(strip, Transform, { x: restX - PITCH * Math.min(1, slide.ms / SLIDE_MS) });
    });
    app.time.onFrame("sync", () => {
      const page = app.ui.rectOf({ projection: "album", key: "albumPage2" });
      const area = app.ui.rectOf({ projection: "album", key: "albumPageArea" });
      const shows =
        page !== undefined &&
        area !== undefined &&
        page.x < area.x + area.w &&
        page.x + page.w > area.x;

      frames.push({ shows, size: subtreeOf(app.ui.tree(), "albumPage2") });
    });
    steps(perf, Math.ceil(SLIDE_MS / 16) + 2);

    const first = frames.findIndex(frame => frame.shows);
    const whole = subtreeOf(app.ui.tree(), "albumPage1");

    expect(first).toBeGreaterThan(0);
    expect(frames[first - 1]?.size).toBeLessThan(whole);
    expect(frames.slice(first).map(frame => frame.size)).toEqual(
      frames.slice(first).map(() => whole)
    );
  });
});
