import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sprite, Transform } from "../../../../renderer/components";
import { defineFilter, resetMadeFilters } from "../../../filters/define";
import { createMockEffects, type MockEffects } from "../mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the dev check of a filter used but not listed. A view carries a
// filter no feature lists in `filters`: without the check it draws unfiltered
// and nothing says why. `defineFilter` keeps what it made only in a dev build,
// and `openWorld` watches it only in a dev build: each gate is tested alone.
// A member is made when its module is first imported, so the one case that
// needs `Flash` imports it inside the test, after the flag and the reset.
// ---------------------------------------------------------------------------

const BODY =
  "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }";

const GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

beforeEach(() => {
  resetMadeFilters();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The `effects:filter-unlisted` lines a mock logged.
 *
 * @param mock - The mock.
 * @returns Their payloads, in order.
 */
function unlisted(mock: MockEffects): unknown[] {
  return vi
    .mocked(mock.log.warn)
    .mock.calls.filter(([event]) => event === "effects:filter-unlisted")
    .map(([, data]) => data);
}

describe("a filter on a view that no feature lists", () => {
  // Bug: a forgotten `filters` entry draws nothing and says nothing.
  it("warns once, naming the member, at the first view; a second view says nothing more", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { Flash } = await import("../../../set/flash");
    const mock = createMockEffects();

    mock.start();

    const first = mock.spawn([Sprite({ texture: "a" }), Transform(), Flash({ amount: 1 })]);

    mock.spawn([Sprite({ texture: "a" }), Transform(), Flash()]);

    expect(unlisted(mock)).toEqual([
      {
        filter: "effects.flash",
        entity: first,
        hint: 'Filter "effects.flash" is on a view but no feature lists it in filters'
      }
    ]);
  });

  // Bug: a hot reload made a second object of a listed id, and the check watches it: "defined twice" at the start.
  it("says nothing for a listed id, also when a second object of it was made after the listed one", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const Tint = defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL });

    defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL });

    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { filters: [Tint] } });

    expect(() => mock.start()).not.toThrow();

    mock.spawn([Sprite({ texture: "a" }), Transform(), Tint()]);

    expect(unlisted(mock)).toEqual([]);
  });

  // Bug: the world holds the id under the object of an earlier load: watching the new one throws "defined twice".
  it("skips an id the world holds under another object", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const Old = defineFilter("fx.glint", { wgsl: BODY, glsl: GLSL });
    const mock = createMockEffects();

    mock.world.ecs.onAdded(Old, () => undefined);
    defineFilter("fx.glint", { wgsl: BODY, glsl: GLSL });

    expect(() => mock.start()).not.toThrow();
  });

  // Bug: the hook outlives its app: a stopped game still warns.
  it("stops watching when the app stops", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const Glint = defineFilter("fx.glint", { wgsl: BODY, glsl: GLSL });
    const mock = createMockEffects();

    mock.start();
    mock.stop();
    mock.spawn([Sprite({ texture: "a" }), Transform(), Glint()]);

    expect(unlisted(mock)).toEqual([]);
  });
});

describe("the two dev gates of the check", () => {
  // Bug: a release build watches every filter it ever made: a hook per component, a line in a shipped game.
  it("adds no hook and logs no line when the start runs in a release build", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const Glint = defineFilter("fx.glint", { wgsl: BODY, glsl: GLSL });

    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const mock = createMockEffects();
    const onAdded = vi.spyOn(mock.world.ecs, "onAdded");

    mock.start();
    mock.spawn([Sprite({ texture: "a" }), Transform(), Glint()]);

    expect(onAdded.mock.calls.some(([watched]) => watched.componentName === "fx.glint")).toBe(
      false
    );
    expect(unlisted(mock)).toEqual([]);
  });

  // Bug: a release build keeps the map of every filter it made: what it made then is watched by a dev start.
  it("logs no line for a filter made in a release build, also when the start runs in a dev build", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const Glint = defineFilter("fx.glint", { wgsl: BODY, glsl: GLSL });

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = createMockEffects();

    mock.start();
    mock.spawn([Sprite({ texture: "a" }), Transform(), Glint()]);

    expect(unlisted(mock)).toEqual([]);
  });
});
