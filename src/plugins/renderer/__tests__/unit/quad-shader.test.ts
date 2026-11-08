import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { filterGlobals, quadShader } from "../../quad";
import { chainQuadOfFilter } from "../quad-harness";

// ---------------------------------------------------------------------------
// The shader of a filter's body on a quad (F126 stage 4): a filter that reads inputs binds each one's texture and
// sampler at group 3; the shader is made with the texture it reads in their place, so Pixi builds the group whole.
// ---------------------------------------------------------------------------

describe("the shader of a quad whose filter reads inputs", () => {
  // Bug: the warm-up of a Bloom throws on its missing input (`renderer:warm-failed effects.bloom`), and its mesh's first
  // draw too: Pixi builds a group only from what is bound, and a filter that binds no numbers had no group 3 at all.
  it("binds each input the quad names to the texture it reads, also with no numbers of its own", () => {
    const source = new pixi.TextureSource({ width: 8, height: 8 });
    const quad = chainQuadOfFilter(["bright", "soft"], undefined);
    const shader = quadShader(pixi, quad, filterGlobals(pixi).group, source);
    const { resources } = shader;

    expect(shader.groups[3]).toBeDefined();
    expect(resources.brightTexture).toBe(source);
    expect(resources.brightSampler).toBe(source.style);
    expect(resources.softTexture).toBe(source);
    expect(resources.softSampler).toBe(source.style);
    expect(resources.uTexture).toBe(source);
  });
});
