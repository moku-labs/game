import { describe, expect, it } from "vitest";
import { Sprite, Transform } from "../../../../renderer/components";
import { defineFilter } from "../../../filters/define";
import { Flash } from "../../../set/flash";
import { createMockEffects } from "../mock-effects";

// ---------------------------------------------------------------------------
// Unit test: a member of the set listed by more than one feature. Two features
// of one game both list `Flash`: the entry that is the same component object as
// one already read is skipped; another component under a taken id still throws.
// ---------------------------------------------------------------------------

/** The built-in kinds, registered before any feature. */
const BUILT_INS = 7;

const BODY =
  "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }";

const GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

describe("a member listed by two features", () => {
  // Bug: a game with two flashing features cannot start, or draws a flashed view through two instances.
  it("is one kind, named once after the built-ins, at the place of the first feature", () => {
    const mock = createMockEffects();
    const Tint = defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL });

    mock.features.push(
      { name: "board", description: { filters: [Flash] } },
      { name: "shop", description: { filters: [Tint, Flash] } }
    );
    mock.start();

    expect(mock.api.diagnostics.kinds().slice(BUILT_INS)).toEqual(["effects.flash", "fx.tint"]);
    expect(mock.state.kinds.get("effects.flash")?.index).toBe(BUILT_INS);

    const view = mock.spawn([Sprite({ texture: "a" }), Transform(), Flash({ amount: 1 })]);

    mock.renderer.displays.add(view);
    mock.frame();

    expect(mock.state.views.get(view)?.instances.size).toBe(1);
  });

  // Bug: the identity skip lets a game's own filter take the member's id: one id, two components.
  it("throws when a game filter takes the member's id", () => {
    const mock = createMockEffects();
    const Own = defineFilter("effects.flash", { wgsl: BODY, glsl: GLSL });

    mock.features.push(
      { name: "board", description: { filters: [Flash] } },
      { name: "shop", description: { filters: [Own] } }
    );

    expect(() => mock.start()).toThrow(
      '[game] Filter "effects.flash" is registered twice.\n  Keep one defineFilter per id.'
    );
  });
});
