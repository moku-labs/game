import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Source, Sprite, Transform } from "../../components";
import type { Drawn } from "../demand-harness";
import { backSeam } from "../quad-harness";
import {
  openSources,
  rendersNow,
  sourceOf,
  spawnRoom,
  spawnWindow,
  stopRunning,
  takesOf,
  windowOf
} from "../source-harness";

afterEach(stopRunning);

// ---------------------------------------------------------------------------
// F126 stage 5 (A10, A11): what a Source holds and frees, the results its windows share, and the paths that keep the
// backdrop: the kept switch off and WebGL.
// ---------------------------------------------------------------------------

describe("a Source's texture", () => {
  // Bug: a Source at ½ is drawn at ¼ (a blurrier glass than asked), or its size is cut, not rounded up.
  it("is the screen at resolution × scale, rounded up", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn, 0.5);

    spawnWindow(drawn);
    drawn.frame();

    const texture = sourceOf(drawn, room).texture;
    const screen = drawn.mock.modules.host.screen();
    const r = drawn.mock.modules.host.resolution();

    expect(texture?.source.pixelWidth).toBe(Math.ceil((screen?.width ?? 0) * r * 0.5));
    expect(texture?.source.pixelHeight).toBe(Math.ceil((screen?.height ?? 0) * r * 0.5));
  });

  // Bug: a typo in the scale draws a full-size texture, silently (A10).
  it("draws another scale at ¼ and warns once in a dev build", async () => {
    const drawn = await openSources({ dev: true });
    const { room } = spawnRoom(drawn, 0.3);

    spawnWindow(drawn);
    drawn.frames(3);

    expect(sourceOf(drawn, room).scale).toBe(0.25);
    const warn = vi.mocked(drawn.mock.ctx.log.warn);

    expect(warn.mock.calls.filter(call => call[0] === "renderer:source-scale")).toEqual([
      ["renderer:source-scale", { entity: room, scale: 0.3 }]
    ]);
  });

  // Bug: a Source removed keeps its texture, and its top stays a render group its parent stops drawing (the spike).
  it("is freed with its render group when the component goes", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);

    spawnWindow(drawn);
    drawn.frame();

    const source = sourceOf(drawn, room);
    const texture = source.texture;
    const top = source.top;

    expect(top?.isRenderGroup).toBe(true);

    drawn.mock.world.ecs.remove(room, Source);
    drawn.frame();

    expect(texture?.destroyed).toBe(true);
    expect(top?.isRenderGroup).toBe(false);
    expect(drawn.mock.ctx.state.kept.sourceByEntity.has(room)).toBe(false);
  });

  // Bug: the last window leaves and the Source keeps a texture nobody reads (A10).
  it("is freed when its last reader goes, and taken again when one comes back", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);

    drawn.frame();

    const source = sourceOf(drawn, room);
    const texture = source.texture;

    drawn.mock.api.sync.filters.set(window, []);
    drawn.frame();

    expect(source.texture).toBeUndefined();
    expect(texture?.destroyed).toBe(true);
    expect(source.dirty).toBe(true);
  });

  // Bug: a hidden room is skipped: the glass keeps the last picture of it.
  it("takes a hidden top as drawn: a transparent picture", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const object = drawn.objectOf(room);

    if (object !== undefined) object.visible = false;

    const from = rendersNow(drawn);

    spawnWindow(drawn);
    drawn.frame();

    expect(takesOf(drawn, sourceOf(drawn, room), from)).toBe(1);
    expect(sourceOf(drawn, room).texture).toBeDefined();
  });

  // Bug (W3): a bare image under Source() is made the root of the take's render group: Pixi's sprite pipe keeps the
  // transform it cached and the root's own tint and alpha are drawn twice, so the glass shows the room misplaced.
  it("wraps a bare view before its first take, and takes the wrapper", async () => {
    const drawn = await openSources();
    const room = drawn.spawn(
      Transform({ x: 30, y: 20 }),
      Sprite({ texture: "room", width: 120, height: 90, tint: 0x40_a0_50 }),
      Source()
    );

    drawn.frame();

    const from = rendersNow(drawn);

    spawnWindow(drawn);
    drawn.frame();

    const view = drawn.mock.ctx.state.sync.views.get(room);
    const source = sourceOf(drawn, room);

    expect(view?.wrapper).toBeDefined();
    expect(source.top).toBe(view?.wrapper);
    expect(view?.object.isRenderGroup).toBe(false);
    expect(takesOf(drawn, source, from)).toBe(1);
  });

  // Bug: `stats().sources` says nothing of what the glass costs.
  it("is counted in stats().sources: count, the take of the frame, its MiB and Mpx", async () => {
    const drawn = await openSources();

    spawnRoom(drawn);
    spawnWindow(drawn);
    drawn.frame();

    const stats = drawn.mock.api.stats().sources;

    expect(stats.count).toBe(1);
    expect(stats.takes).toBe(1);
    expect(stats.mb).toBeGreaterThan(0);
    expect(stats.mpx).toBeGreaterThan(0);
  });
});

/**
 * The chain renders of a Source since a point: renders of its keeper's sprite, whose apply draws the chain.
 *
 * @param drawn - The running renderer.
 * @param room - The Source's entity.
 * @param from - The log length to count from.
 * @returns How many.
 */
function chainsOf(drawn: Drawn, room: Entity, from = 0): number {
  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.container.label === `source:${room}#chain`).length;
}

describe("the results drawn from a Source", () => {
  // Bug: eight notes over one room each run their own blur: eight chains where one does.
  it("are shared by two windows of equal keys: one chain run", async () => {
    const drawn = await openSources();
    const from = rendersNow(drawn);
    const { room } = spawnRoom(drawn);
    const a = spawnWindow(drawn, backSeam(7), { x: 20, y: 20 });
    const b = spawnWindow(drawn, backSeam(7), { x: 120, y: 120 });

    drawn.frames(3);

    expect(chainsOf(drawn, room, from)).toBe(1);
    expect(windowOf(drawn, a).held).toBe(windowOf(drawn, b).held);
    expect(windowOf(drawn, a).held?.refs).toBe(2);
  });

  // Bug (W6): a retake of a Source read by two windows gives them a new result object and new targets every time, the
  // old ones destroyed: a room that changes every frame allocates and frees textures every frame.
  it("are drawn again in place for two windows of equal keys when the Source is taken again", async () => {
    const drawn = await openSources();
    const { room, child } = spawnRoom(drawn);
    const a = spawnWindow(drawn, backSeam(7), { x: 20, y: 20 });
    const b = spawnWindow(drawn, backSeam(7), { x: 120, y: 120 });

    drawn.frames(3);

    const held = windowOf(drawn, a).held;
    const target = held?.targets[0];
    const from = rendersNow(drawn);

    drawn.mock.world.ecs.set(child, Transform, { x: 40 });
    drawn.frame();

    expect(takesOf(drawn, sourceOf(drawn, room), from)).toBe(1);
    expect(chainsOf(drawn, room, from)).toBe(1);
    expect(windowOf(drawn, a).held).toBe(held);
    expect(windowOf(drawn, b).held).toBe(held);
    expect(held?.targets[0]).toBe(target);
    expect(target?.destroyed).toBe(false);
    expect(held?.at).toBe(sourceOf(drawn, room).version);
  });

  // Bug (W6): every take asks each window's seam for its key, a fraction (the Source's resolution) handed to a call,
  // though nothing of its steps moved.
  it("ask no key of a window whose steps stand when the Source is taken again", async () => {
    const drawn = await openSources();
    const { child } = spawnRoom(drawn);
    const seam = backSeam(7);
    const asked: number[] = [];
    const inputs = {
      ...seam.inputs,
      key: (resolution: number): number => {
        asked.push(resolution);

        return seam.state.key;
      }
    };

    spawnWindow(drawn, { ...seam, inputs });
    drawn.frames(3);
    asked.length = 0;

    drawn.mock.world.ecs.set(child, Transform, { x: 40 });
    drawn.frame();

    expect(asked).toEqual([]);
  });

  // Bug (W6): a version of the steps that moves to the same key (a tween back to where it was) makes the windows that
  // share a result build a new one, new targets with it, at the next take.
  it("keep their shared result when their steps move to an equal key", async () => {
    const drawn = await openSources();
    const { child } = spawnRoom(drawn);
    const one = backSeam(7);
    const two = backSeam(7);
    const a = spawnWindow(drawn, one, { x: 20, y: 20 });
    const b = spawnWindow(drawn, two, { x: 120, y: 120 });

    drawn.frames(3);

    const held = windowOf(drawn, a).held;
    const target = held?.targets[0];

    one.state.version += 1;
    two.state.version += 1;
    drawn.mock.world.ecs.set(child, Transform, { x: 40 });
    drawn.frame();

    expect(windowOf(drawn, a).held).toBe(held);
    expect(windowOf(drawn, b).held).toBe(held);
    expect(held?.targets[0]).toBe(target);
    expect(target?.destroyed).toBe(false);
  });

  // Bug: one of two windows that share a result tweens its blur, and the result is drawn again in place with its new
  // steps: the other window, whose steps did not move, shows the tweened blur.
  it("give a window whose steps moved a result of its own while the other keeps theirs", async () => {
    const drawn = await openSources();

    spawnRoom(drawn);

    const moving = backSeam(7);
    const a = spawnWindow(drawn, moving, { x: 20, y: 20 });
    const b = spawnWindow(drawn, backSeam(7), { x: 120, y: 120 });

    drawn.frames(3);

    const shared = windowOf(drawn, b).held;

    moving.state.key = 8;
    moving.state.version += 1;
    drawn.mock.api.invalidate(a);
    drawn.frame();

    expect(windowOf(drawn, b).held).toBe(shared);
    expect(shared?.key).toBe(7);
    expect(windowOf(drawn, a).held?.key).toBe(8);
  });

  // Bug: a tweened blur retakes the room in every frame, or never reruns its chain (A10).
  it("rerun the chain without a take when its steps change", async () => {
    const drawn = await openSources();
    const seam = backSeam(7);
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn, seam);

    drawn.frames(4);

    const from = rendersNow(drawn);

    // The steps change: effects moves the version with the key.
    seam.state.key = 8;
    seam.state.version += 1;
    drawn.mock.api.invalidate(window);
    drawn.frame();

    expect(chainsOf(drawn, room, from)).toBe(1);
    expect(takesOf(drawn, sourceOf(drawn, room), from)).toBe(0);
    expect(windowOf(drawn, window).held?.key).toBe(8);
  });

  // Bug: a chain that gets a target where it had a hole (a blur tweened up from 0) draws it, but the window's mesh keeps
  // binding the Source for that input: the glass shows no blur.
  it("bind a target that took the place of a hole on the window's mesh", async () => {
    const drawn = await openSources();
    const seam = backSeam(7, undefined);

    spawnRoom(drawn);

    const window = spawnWindow(drawn, seam);

    drawn.frames(4);

    seam.state.scale = 0.5;
    seam.state.key = 8;
    seam.state.version += 1;
    drawn.mock.api.invalidate(window);
    drawn.frames(2);

    const record = windowOf(drawn, window);
    const target = record.held?.targets[0];

    expect(target).toBeDefined();
    expect(record.shade?.shader.resources.blurTexture).toBe(target?.source);
  });

  // Bug: the chain is drawn at the canvas resolution from a picture at ¼: four times the texels, another blur.
  it("are drawn from the Source's own resolution", async () => {
    const drawn = await openSources();
    const seam = backSeam();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn, seam);

    drawn.frame();

    const source = sourceOf(drawn, room);
    const keeper = source.keeper;
    const input = source.texture;

    expect(keeper?.resolution).toBe(drawn.mock.modules.host.resolution() * 0.25);

    // The keeper's apply draws the result being drawn from Pixi's copy of the Source, at the copy's resolution.
    source.drawing = windowOf(drawn, window).held;
    if (input !== undefined)
      keeper?.apply({} as Parameters<NonNullable<typeof keeper>["apply"]>[0], input, input, false);
    source.drawing = undefined;

    expect(seam.draws).toEqual([input?.source.resolution]);
    expect(windowOf(drawn, window).held?.targets[0]?.source.resolution).toBe(
      (input?.source.resolution ?? 0) * 0.5
    );
  });
});

describe("the placement of a served window", () => {
  // Bug: a sliding note reads the blur at its old place: its offset is not written, or written once (A3).
  it("writes the window's place over the Source into its offsets, in every frame it moves, with no take", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn, backSeam(), { x: 50, y: 60 });

    drawn.frames(6);

    const source = sourceOf(drawn, room);
    const uniforms = windowOf(drawn, window).shade?.quad.fu?.uniforms as Record<
      string,
      Float32Array
    >;
    const width = source.texture?.source.width ?? 0;
    const height = source.texture?.source.height ?? 0;
    const from = rendersNow(drawn);

    expect([...(uniforms.backOffset ?? [])]).toEqual([
      Math.fround(50 / width),
      Math.fround(60 / height)
    ]);
    expect([...(uniforms.blurScale ?? [])]).toEqual([
      Math.fround(1 / width),
      Math.fround(1 / height)
    ]);

    drawn.mock.world.ecs.set(window, Transform, { x: 90 });
    drawn.frame();

    expect(uniforms.backOffset?.[0]).toBe(Math.fround(90 / width));
    expect(uniforms.blurOffset?.[0]).toBe(Math.fround(90 / width));
    expect(takesOf(drawn, source, from)).toBe(0);
  });
});

describe("the backdrop path stays", () => {
  // Bug: a window whose Source went stays on a quad over a texture that is gone (A12).
  it("for a window whose Source is removed: live the next frame", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);

    drawn.frames(6);

    expect(windowOf(drawn, window).mode).toBe("kept");

    drawn.mock.world.ecs.remove(room, Source);
    drawn.frame();

    expect(windowOf(drawn, window).source).toBeUndefined();
    expect(windowOf(drawn, window).mode).toBe("live");
    expect(windowOf(drawn, window).why).toBe(2);
  });

  // Bug (B1): a window whose filter is switched off for a frame forgets its Source but keeps the structure version it
  // found it at, so when the filter is back it never finds again: on the backdrop path for good.
  it("for a window whose filter was off for a frame: served from its Source again once it is back", async () => {
    // Pixi's own sort on every render: a find through the sorted layer is kept, as on a device.
    const drawn = await openSources({ builds: true });
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);

    drawn.frames(6);

    const record = windowOf(drawn, window);
    const filter = record.slots[0]?.filter;

    expect(record.mode).toBe("kept");

    if (filter !== undefined) filter.enabled = false;
    drawn.mock.api.invalidate(window);
    drawn.frame();

    expect(record.source).toBeUndefined();

    if (filter !== undefined) filter.enabled = true;
    drawn.mock.api.invalidate(window);
    drawn.frames(6);

    expect(windowOf(drawn, window).source).toBe(sourceOf(drawn, room));
    expect(windowOf(drawn, window).mode).toBe("kept");
    expect(windowOf(drawn, window).shaded).toBe(true);
  });

  // Bug: with the kept switch off a window still draws over a Source, or the Source keeps its texture (A6).
  it("with the kept switch off: the window is live, the Source holds nothing", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);

    drawn.frames(6);

    expect(windowOf(drawn, window).mode).toBe("kept");

    drawn.mock.api.sync.debug.kept(false);
    drawn.frames(2);

    expect(windowOf(drawn, window).mode).toBe("live");
    expect(sourceOf(drawn, room).texture).toBeUndefined();
  });

  // Bug: WebGL, which has no quad twin, draws a window on a quad it cannot run (A7).
  it("on WebGL: no reader, no texture, the window live", async () => {
    const drawn = await openSources({ kind: "webgl" });
    const { room } = spawnRoom(drawn);
    const window = spawnWindow(drawn);

    drawn.frames(6);

    expect(windowOf(drawn, window).reader).toBe(false);
    expect(windowOf(drawn, window).mode).toBe("live");
    expect(sourceOf(drawn, room).texture).toBeUndefined();
  });
});
