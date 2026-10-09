import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createSyncState } from "../../sync/state";
import { destroyTexture } from "../../sync/textures";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: what `destroyTexture`
// does to the bind groups Pixi keeps. Pixi 8.21 caches the bind group of every
// batch in a module map that is never emptied, and the texture system keeps one
// per texture a particle container drew. Each of them listens to `change` on
// the source and on its style, and warns when one of the two is destroyed.
// ---------------------------------------------------------------------------

/** The texture slots of a batch bind group on a common device. */
const SLOTS = 16;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Makes a texture over a source of its own, as `textures.create` does for a loose file.
 *
 * @returns The texture.
 */
function loose(): pixi.Texture {
  return new pixi.Texture({ source: new pixi.TextureSource({ width: 4, height: 4 }) });
}

/**
 * Does to a texture what drawing does in Pixi: the batcher caches a bind group over its source,
 * also one with a neighbour in the same batch, and the texture system keeps one of its own.
 *
 * @param texture - The texture a frame drew.
 * @returns The three bind groups that hold its source now.
 */
function draw(texture: pixi.Texture): pixi.BindGroup[] {
  const neighbour = loose();

  return [
    pixi.getTextureBatchBindGroup([texture.source], 1, SLOTS),
    pixi.getTextureBatchBindGroup([neighbour.source, texture.source], 2, SLOTS),
    new pixi.BindGroup({ 0: texture.source, 1: texture.source.style })
  ];
}

/**
 * Catches the console, where Pixi writes its warnings.
 *
 * @returns The spy.
 */
function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * Counts the `[BindGroup]` warnings Pixi wrote.
 *
 * @param spy - The spy on `console.warn`.
 * @returns How many calls carried one.
 */
function bindGroupWarnings(spy: MockInstance<typeof console.warn>): number {
  return spy.mock.calls.filter(call => call.some(part => String(part).includes("[BindGroup]")))
    .length;
}

describe("destroying a texture Pixi drew", () => {
  it("warns twice per bind group when Pixi destroys it on its own: the reason for the fix", () => {
    const spy = quiet();
    const texture = loose();

    draw(texture);
    texture.destroy(true);

    // Three bind groups, each for the source and for its sampler. The CI pin: when a Pixi
    // release stops warning here, `destroyTexture` can stop removing the listeners.
    expect(bindGroupWarnings(spy)).toBe(6);
  });

  it("prints no bind group warning through destroyTexture", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const texture = loose();
    const source = texture.source;

    draw(texture);
    destroyTexture(state, texture);

    expect(bindGroupWarnings(spy)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it("is quiet on a later destroy too, when other textures were drawn since", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const old = loose();

    draw(old);
    // The frames after a hot swap draw the new texture: the cache still holds the old source.
    for (let frame = 0; frame < 3; frame += 1) draw(loose());
    destroyTexture(state, old);

    expect(bindGroupWarnings(spy)).toBe(0);
  });

  it("leaves the listeners of a source that stays: a slice frees only its wrapper", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const page = loose();
    const slice = new pixi.Texture({ source: page.source, frame: new pixi.Rectangle(0, 0, 2, 2) });

    state.slices.add(slice);
    draw(slice);

    const listeners = page.source.listenerCount("change");
    const styleListeners = page.source.style.listenerCount("change");

    destroyTexture(state, slice);

    // Three bind groups listen to the source; the style has them and the source itself.
    expect(listeners).toBe(3);
    expect(styleListeners).toBe(4);
    expect(page.source.listenerCount("change")).toBe(listeners);
    expect(page.source.style.listenerCount("change")).toBe(styleListeners);
    expect(slice.destroyed).toBe(true);
    expect(page.source.destroyed).toBe(false);
    expect(bindGroupWarnings(spy)).toBe(0);

    // The page frees the source the slices shared, as quietly.
    destroyTexture(state, page);

    expect(page.destroyed).toBe(true);
    expect(bindGroupWarnings(spy)).toBe(0);
  });

  it("frees a texture once, however often it is asked", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const texture = loose();

    draw(texture);
    destroyTexture(state, texture);

    expect(() => destroyTexture(state, texture)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
