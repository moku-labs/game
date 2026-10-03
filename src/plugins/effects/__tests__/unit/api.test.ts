import { describe, expect, it } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import { Glow } from "../../filters/builtins";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture } from "../fake-effects-pixi";
import { createMockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: app.effects.stats() — the plugin's own counts and the renderer's
// render passes, read at call time
// ---------------------------------------------------------------------------

const page = { width: 128, height: 128, destroyed: false };

describe("stats", () => {
  it("answers zeros before anything runs, with the renderer's passes", () => {
    const mock = createMockEffects();

    mock.renderer.passes = 0;
    mock.start();

    expect(mock.api.stats()).toEqual({ particles: 0, emitters: 0, filters: 0, renderPasses: 0 });
  });

  it("counts particles, instances with orphans, filter instances and reads the passes at call time", () => {
    const mock = createMockEffects();
    const stars = defineEmitter("fx.stars", {
      textures: ["fx.star"],
      burst: 8,
      lifeMs: [5000, 5000]
    });

    mock.features.push({ name: "board", description: { emitters: [stars] } });
    mock.textures.set("fx.star", atlasTexture(page));
    mock.start();

    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);
    const view = mock.spawn([Sprite({ texture: "a" }), Transform(), Glow()]);

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.renderer.displays.add(view);
    mock.frame();
    mock.world.ecs.despawn(host);
    mock.renderer.passes = 3;

    const first = mock.api.stats();

    expect(first).toEqual({ particles: 16, emitters: 2, filters: 1, renderPasses: 3 });
    expect(mock.api.stats()).not.toBe(first);
  });
});
