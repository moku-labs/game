import { describe, expect, it } from "vitest";
import { createHandlers } from "../../handlers";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the `ui:hot-swap` hook — a saved module's emitters replace the
// registered ones by id, their bake is dropped, live instances keep theirs
// ---------------------------------------------------------------------------

const page = { width: 128, height: 128, destroyed: false };

const stars = defineEmitter("fx.stars", { textures: ["fx.star"], burst: 5, lifeMs: [5000, 5000] });
const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 10 });

/**
 * A started mock with two emitters registered by one feature.
 *
 * @returns The mock.
 */
function started(): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "board", description: { emitters: [stars, steam] } });
  mock.textures.set("fx.star", atlasTexture(page));
  mock.textures.set("fx.sparkle", atlasTexture(page));
  mock.textures.set("fx.puff", atlasTexture(page));
  mock.start();

  return mock;
}

describe("ui:hot-swap", () => {
  it("replaces a registered emitter and drops its bake, so the next instance bakes the new config", () => {
    const mock = started();
    const first = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();

    const old = mock.state.instances.get(first);

    expect(old?.baked.config.burst).toBe(5);
    expect(mock.state.baked.has("fx.stars")).toBe(true);

    const next = defineEmitter("fx.stars", {
      textures: ["fx.sparkle"],
      burst: 9,
      lifeMs: [5000, 5000]
    });

    createHandlers(mock.ctx)["ui:hot-swap"]({
      file: "features/board/effects.ts",
      module: { stars: next }
    });

    expect(mock.state.emitters.get("fx.stars")).toBe(next);
    expect(mock.state.baked.has("fx.stars")).toBe(false);
    expect(mock.state.instances.get(first)).toBe(old);
    expect(mock.log.warn).not.toHaveBeenCalled();

    const second = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();

    expect(mock.state.instances.get(second)?.baked.config.burst).toBe(9);
    expect(mock.state.instances.get(first)?.baked.config.burst).toBe(5);
  });

  it("warns for an emitter id no feature registered and registers nothing", () => {
    const mock = started();
    const unknown = defineEmitter("fx.rain", { textures: ["fx.puff"], rate: 4 });

    createHandlers(mock.ctx)["ui:hot-swap"]({
      file: "features/board/effects.ts",
      module: { unknown }
    });

    expect(mock.log.warn).toHaveBeenCalledWith("effects:hot-unknown-emitter", { id: "fx.rain" });
    expect(mock.state.emitters.has("fx.rain")).toBe(false);
  });

  it("ignores exports that are not emitter definitions", () => {
    const mock = started();
    const before = [...mock.state.emitters.entries()];

    mock.spawn([Emitter({ effect: "fx.steam" })]);
    mock.frame();

    createHandlers(mock.ctx)["ui:hot-swap"]({
      file: "features/board/styles.ts",
      module: {
        palette: { gold: 0xff_d7_00 },
        scale: 2,
        view: () => [],
        steam: { id: "fx.steam", config: "not an object" },
        nothing: undefined
      }
    });

    expect([...mock.state.emitters.entries()]).toEqual(before);
    expect(mock.state.baked.has("fx.steam")).toBe(true);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});
