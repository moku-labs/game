import * as pixi from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Parent, Shape, Source, Sprite, Transform } from "../../components";
import { findSource } from "../../kept/source";
import { createKeptState } from "../../kept/state";
import type { KeptState, SourceRecord } from "../../kept/types";
import type { PixiContainer } from "../../types";
import { OWNER } from "../demand-harness";
import {
  openSources,
  sourceOf,
  spawnRoom,
  spawnWindow,
  stopRunning,
  windowOf
} from "../source-harness";

afterEach(stopRunning);

// ---------------------------------------------------------------------------
// F126 stage 5: the find of a window's Source. From the window's top up the parents, the earlier siblings at each
// level, last first, each subtree depth first, last child first; an ancestor's own Source never counts.
// ---------------------------------------------------------------------------

/**
 * A kept state whose Sources are these containers.
 *
 * @param tops - The tops that carry `Source`.
 * @returns The state, and the record of each top in order.
 */
function stateWith(...tops: PixiContainer[]): { state: KeptState; records: SourceRecord[] } {
  const state = createKeptState({ keptMb: 64, debug: {} });
  const records = tops.map((top, index) => {
    const record: SourceRecord = {
      entity: index + 1,
      top,
      wasGroup: false,
      scale: 0.25,
      texture: undefined,
      resolution: 0,
      version: 0,
      dirty: true,
      readers: 0,
      held: [],
      matrix: new pixi.Matrix(),
      seen: new pixi.Matrix(),
      identity: new pixi.Matrix(),
      sprite: undefined,
      keeper: undefined,
      drawing: undefined,
      bytes: 0
    };

    state.sources.push(record);
    state.sourceByTop.set(top, record);

    return record;
  });

  return { state, records };
}

/**
 * A container with these children, in order.
 *
 * @param children - Its children.
 * @returns The container.
 */
function node(...children: PixiContainer[]): PixiContainer {
  const container = new pixi.Container();

  for (const child of children) container.addChild(child);

  return container;
}

describe("findSource", () => {
  // Bug: the window reads a picture drawn after it (over it), or nothing at all.
  it("finds an earlier sibling, the nearest one first", () => {
    const far = node();
    const near = node();
    const window = node();
    const after = node();

    node(far, near, window, after);

    const { state, records } = stateWith(far, near, after);

    expect(findSource(state, window)).toBe(records[1]);
  });

  // Bug: a deeper Source in an earlier sibling is missed, or the first drawn one wins over the last drawn.
  it("walks an earlier sibling's subtree last child first, depth first", () => {
    const first = node();
    const last = node();
    const deep = node(node(), last);
    const window = node();

    node(node(first, deep), window);

    const { state, records } = stateWith(first, last);

    expect(findSource(state, window)).toBe(records[1]);
  });

  // Bug: the window reads itself: a Source on an ancestor would draw the window into its own glass.
  it("ignores an ancestor's own Source, and finds one at a level above", () => {
    const below = node();
    const window = node();
    const parent = node(window);

    node(below, parent);

    const { state, records } = stateWith(parent, below);

    expect(findSource(state, window)).toBe(records[1]);
    expect(findSource(stateWith(parent).state, window)).toBeUndefined();
  });

  // Bug: a window with no Source under it is served by some Source anywhere in the tree.
  it("answers undefined with no Source drawn before the window", () => {
    const window = node();

    node(window, node());

    expect(findSource(stateWith().state, window)).toBeUndefined();
    expect(findSource(stateWith(node()).state, window)).toBeUndefined();
  });
});

describe("the cached find of a window", () => {
  // Bug: a window reparented away from its Source keeps reading it (or one moved under a Source never finds it).
  it("finds again after a reparent, and keeps its answer while nothing moves", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);
    const record = windowOf(drawn, window);
    const source = sourceOf(drawn, room);

    expect(record.source).toBe(source);

    const seen = record.sourceAt;

    drawn.frames(3);

    expect(record.sourceAt).toBe(seen);

    // Under the room now: the room is its ancestor, never its Source.
    drawn.mock.world.ecs.add(window, Parent({ entity: room }));
    drawn.frames(2);

    expect(windowOf(drawn, window).source).toBeUndefined();

    // Back in the layer, after the room: found again.
    drawn.mock.world.ecs.remove(window, Parent);
    drawn.frames(2);

    expect(windowOf(drawn, window).source).toBe(source);
  });

  // Bug (W5): every depth write of a y-sorted layer moves the structure version, so in a game with a walking character
  // every frosted window walks the tree for its Source in every frame.
  it("keeps its answer while a sprite walks in a y-sorted layer that holds no Source", async () => {
    // Pixi's own sort on every render, as on a device: the layer is sorted again after each depth write.
    const drawn = await openSources({ builds: true });
    const { ecs, projection } = drawn.mock.world;

    projection.setLayers([
      { name: "room", sort: "none" },
      { name: "items", sort: "y" }
    ]);
    drawn.frame();

    const room = ecs.spawn(OWNER, [
      Layer({ name: "room" }),
      Transform({ x: 0, y: 0 }),
      Shape({ w: 200, h: 200 }),
      Source()
    ]);

    ecs.spawn(OWNER, [
      Parent({ entity: room }),
      Transform({ x: 10, y: 10 }),
      Shape({ w: 20, h: 20 })
    ]);

    const walker = drawn.spawn(
      Transform({ x: 20, y: 0 }),
      Sprite({ texture: "hero", width: 8, height: 8 })
    );

    drawn.frame();

    const window = spawnWindow(drawn);

    drawn.frames(4);

    const record = windowOf(drawn, window);
    const sync = drawn.mock.ctx.state.sync;
    const seen = sync.structureVersion;

    expect(record.source).toBe(sourceOf(drawn, room));
    expect(record.sourceAt).toBe(seen);

    // The walker crosses the window's depth back and forth: its zIndex changes in every frame.
    for (let frame = 1; frame <= 6; frame += 1) {
      ecs.set(walker, Transform, { y: frame % 2 === 0 ? 0 : 120 });
      drawn.frame();
    }

    expect(sync.structureVersion).toBe(seen);
    expect(record.sourceAt).toBe(seen);

    // A view hung in the walker's layer moves the version in a frame the walker writes its depth: the window finds
    // again, and its answer is kept though its layer waits for Pixi's sort (no Source hangs there).
    ecs.set(walker, Transform, { y: 120 });
    drawn.spawn(Transform({ x: 300, y: 300 }), Shape({ w: 4, h: 4 }));
    drawn.frame();

    expect(sync.structureVersion).toBeGreaterThan(seen);
    expect(record.sourceAt).toBe(sync.structureVersion);
  });

  // Bug: the find reads the structure version before the Source's new top bumps it, so it finds once more in the next
  // frame for nothing.
  it("holds the find made in the frame its Source got its top", async () => {
    const drawn = await openSources({ builds: true });
    const room = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 200, h: 200 }));
    const window = spawnWindow(drawn);

    drawn.frames(3);
    drawn.mock.world.ecs.add(room, Source());
    drawn.frame();

    const record = windowOf(drawn, window);

    expect(record.source).toBe(sourceOf(drawn, room));
    expect(record.sourceAt).toBe(drawn.mock.ctx.state.sync.structureVersion);
  });
});
