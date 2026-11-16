import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { destroyWhole } from "../../sources";

// ---------------------------------------------------------------------------
// F194: Pixi 8.22 caches the bind group of every batch it drew, forever (`getTextureBatchBindGroup`), and each one
// listens to `change` on every source and style it binds, `Texture.EMPTY` included for the padding slots. The
// engine's destroy leaves the groups holding no destroyed source and, once a group binds nothing live, no listener on
// EMPTY. Real Pixi groups, made the way a drawn batch makes them.
// ---------------------------------------------------------------------------

/** The texture slots of a batch bind group on a common device. */
const SLOTS = 16;

const EMPTY = pixi.Texture.EMPTY.source;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A texture with its own source, as the renderer loads one.
 *
 * @returns The texture.
 */
function made(): pixi.Texture {
  return new pixi.Texture({ source: new pixi.TextureSource({ width: 4, height: 4 }) });
}

/**
 * The batch bind group Pixi caches for these textures.
 *
 * @param textures - The textures of the batch.
 * @returns The cached group.
 */
function batch(...textures: pixi.Texture[]): pixi.BindGroup {
  return pixi.getTextureBatchBindGroup(
    textures.map(texture => texture.source),
    textures.length,
    SLOTS
  );
}

/**
 * How many `change` listeners of a group an emitter holds.
 *
 * @param emitter - A source or a style.
 * @param group - The group.
 * @returns The count.
 */
function listening(emitter: pixi.TextureSource | pixi.TextureStyle, group: pixi.BindGroup): number {
  const events = (emitter as unknown as { _events: Record<string, unknown> })._events.change;

  if (events === undefined) return 0;

  const list = (Array.isArray(events) ? events : [events]) as Array<{ context: unknown }>;

  return list.filter(listener => listener.context === group).length;
}

/**
 * Every resource the group binds.
 *
 * @param group - The group.
 * @returns The resources.
 */
function bound(group: pixi.BindGroup): unknown[] {
  return Object.values(group.resources);
}

/**
 * Catches the console, where Pixi writes its warnings.
 *
 * @returns The spy.
 */
function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("destroyWhole and Pixi's cached batch bind groups", () => {
  // Bug: the group keeps the destroyed source and its style (F194: ~1100 destroyed ImageSources after 5 loops).
  it("leaves no group holding the destroyed source or its style", () => {
    const texture = made();
    const { source } = texture;
    const style = source.style;
    const group = batch(texture);

    destroyWhole(texture);

    expect(bound(group)).not.toContain(source);
    expect(bound(group)).not.toContain(style);
    expect(bound(group)).toContain(EMPTY);
  });

  // Bug: a group whose last texture went keeps one listener per padding slot on EMPTY (F194: 9936 → 49336).
  it("drops a dead group's listeners from EMPTY's source and style", () => {
    const texture = made();
    const group = batch(texture);

    expect(listening(EMPTY, group)).toBe(SLOTS - 1);

    destroyWhole(texture);

    expect(listening(EMPTY, group)).toBe(0);
    expect(listening(EMPTY.style, group)).toBe(0);
  });

  // Bug: a group that still draws a live texture loses its listeners and never learns that texture changed.
  it("keeps every listener of a group that still binds a live texture", () => {
    const gone = made();
    const live = made();
    const group = batch(gone, live);

    destroyWhole(gone);

    expect(bound(group)).toContain(live.source);
    expect(listening(live.source, group)).toBe(1);
    expect(listening(EMPTY, group)).toBe(SLOTS - 2);

    destroyWhole(live);

    expect(listening(EMPTY, group)).toBe(0);
  });

  // Bug: another group's listeners on EMPTY go with the dead one's.
  it("leaves the listeners of other groups on EMPTY", () => {
    const gone = made();
    const other = made();
    const kept = batch(other);

    destroyWhole(gone);

    expect(listening(EMPTY, kept)).toBe(SLOTS - 1);
    other.destroy(true);
  });

  // Bug: a shared style, live on another source, holds the dead group, or loses that source's own listener.
  it("lets a dead group go from a shared style and keeps the style's other listeners", () => {
    const shared = new pixi.TextureStyle();
    const first = made();
    const second = made();

    first.source.style = shared;
    second.source.style = shared;
    const group = batch(first);

    destroyWhole(first);

    expect(listening(shared, group)).toBe(0);
    expect(bound(group)).not.toContain(shared);
    expect(shared.listenerCount("change")).toBe(1);
    second.destroy(true);
  });

  // Bug: the destroy warns `[BindGroup] ... destroyed while still bound to a shader` once per source and style.
  it("destroys without a bind group warning", () => {
    const texture = made();
    const spy = quiet();

    batch(texture);
    destroyWhole(texture);

    expect(texture.destroyed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
