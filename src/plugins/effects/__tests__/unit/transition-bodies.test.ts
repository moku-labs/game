import { describe, expect, it } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { defineFilter } from "../../filters/define";
import { Dissolve } from "../../set/dissolve";
import { Flash } from "../../set/flash";
import { RevealLine } from "../../set/reveal-line";
import { RevealRound } from "../../set/reveal-round";
import { markTransition, transitionMarkOf } from "../../set/transition-mark";
import { FakeFxFilter, type FakeMessage } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the bodies `effects` hands the renderer for a scene transition (spec 36). A set member that carries a
// transition mark and is listed in a feature's `filters` hands its body once, after its quad check settled, under its
// kind and its export name; stop takes it back and destroys the warm filter it made.
// ---------------------------------------------------------------------------

/** Lets the compilation info resolve. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/**
 * A started mock on WebGPU with the device the checks compile on, the first frame run and the checks settled.
 *
 * @param filters - The filters of the one feature.
 * @param answer - What the device reports for a source; clean by default.
 * @returns The mock.
 */
async function started(
  filters: readonly FeatureFilter[],
  answer?: (code: string) => FakeMessage[]
): Promise<MockEffects> {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  if (answer !== undefined) mock.gpu.answer = answer;
  mock.features.push({ name: "fixture", description: { filters } });
  mock.start();
  mock.frame();
  await settle();

  return mock;
}

describe("the bodies handed to the renderer", () => {
  // Bug: a wipe, an iris or a dissolve plays as a fade because the body never reached the renderer.
  it("a listed member hands its body once, under its kind and its export name", async () => {
    const mock = await started([RevealLine]);

    mock.frame();
    await settle();

    expect(mock.renderer.bodies.map(({ kind, member }) => ({ kind, member }))).toEqual([
      { kind: "wipe", member: "RevealLine" }
    ]);
    expect(mock.renderer.bodies[0]?.quad.program).toBeDefined();
    expect(mock.renderer.bodies[0]?.quad.fu).toBeDefined();
  });

  // Bug: one kind's body is handed under another kind's name, so an iris draws as a wipe.
  it("the three members hand under wipe, iris and dissolve", async () => {
    const mock = await started([RevealLine, RevealRound, Dissolve]);

    expect(mock.renderer.bodies.map(({ kind, member }) => [kind, member])).toEqual([
      ["wipe", "RevealLine"],
      ["iris", "RevealRound"],
      ["dissolve", "Dissolve"]
    ]);
  });

  // Bug: a member listed by two features hands two bodies, and the second replaces the first with a stale quad.
  it("a member two features list hands once", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.features.push(
      { name: "board", description: { filters: [RevealLine] } },
      { name: "shop", description: { filters: [RevealLine] } }
    );
    mock.start();
    mock.frame();
    await settle();

    expect(mock.renderer.bodies).toHaveLength(1);
  });

  // Bug: a game that lists none hands a body, or a filter without a mark does: its shader is built for nothing.
  it("hands nothing when no mark is listed", async () => {
    const mock = await started([Flash]);

    expect(mock.renderer.bodies).toEqual([]);
    const empty = await started([]);

    expect(empty.renderer.bodies).toEqual([]);
  });

  // Bug: a body is handed before its shader was checked: an unchecked program reaches the GPU.
  it("hands nothing before the quad check settled", async () => {
    const held = Promise.withResolvers<void>();
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.waits.set(RevealLine.filter.source, held.promise);
    mock.features.push({ name: "fixture", description: { filters: [RevealLine] } });
    mock.start();
    mock.frame();
    await settle();

    expect(mock.renderer.bodies).toEqual([]);

    held.resolve();
    await settle();

    expect(mock.renderer.bodies).toHaveLength(1);
  });

  // Bug: a member whose quad does not compile hands a quad program that fails on the GPU in the frame of the switch.
  it("a member whose quad check failed hands nothing", async () => {
    const mock = await started([RevealLine, Dissolve], code =>
      code === RevealLine.filter.quadSource
        ? [{ type: "error", lineNum: 1, linePos: 1, message: "bad" }]
        : []
    );

    expect(mock.renderer.bodies.map(({ member }) => member)).toEqual(["Dissolve"]);
  });

  // Bug: the renderer keeps a body whose uniform buffers are freed; or the probe outlives the app.
  it("stop takes every body back and destroys the warm filter", async () => {
    const mock = await started([RevealLine, RevealRound]);

    expect(mock.renderer.bodies.every(body => !body.takenBack)).toBe(true);

    mock.stop();

    expect(mock.renderer.bodies.map(body => body.takenBack)).toEqual([true, true]);
  });

  // Bug: the renderer lost its Pixi since the checks ran, and the hand-over builds a filter on nothing.
  it("hands nothing when the renderer is not ready any more at the settle", async () => {
    const held = Promise.withResolvers<void>();
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.waits.set(RevealLine.filter.source, held.promise);
    mock.features.push({ name: "fixture", description: { filters: [RevealLine] } });
    mock.start();
    mock.frame();
    mock.renderer.ready = false;
    held.resolve();
    await settle();

    expect(mock.renderer.bodies).toEqual([]);
  });
});

describe("the warm filter of a handed body", () => {
  // Bug: the warm filter is the one of the quad program but never destroyed: its uniform buffer leaks at every restart.
  it("is destroyed at stop, after the renderer took the body back", async () => {
    const mock = await started([Dissolve]);
    // The body's filter is the one built over the member's own program.
    const filter = FakeFxFilter.made.find(
      made =>
        (made.options.gpuProgram as { options: { name: string } }).options.name ===
        Dissolve.filter.id
    );

    expect(mock.renderer.bodies).toHaveLength(1);
    expect(filter?.destroyed).toBe(false);

    mock.stop();

    expect(filter?.destroyed).toBe(true);
  });
});

describe("the uniform group of a handed body", () => {
  // Bug: the group is rebuilt for in-place writes and drops a field or the colour's own array: the renderer's by-name
  // writes land on an undeclared uniform, and a dissolve's rim has no channels to write.
  it("keeps every declared uniform, the colour as its three-channel array, every number at the probe's 0", async () => {
    const mock = await started([RevealLine, Dissolve]);
    const [wipe, dissolve] = mock.renderer.bodies;

    expect(wipe?.quad.fu?.uniforms).toEqual({ progress: 0, angle: 0, soft: 0 });
    expect(dissolve?.quad.fu?.uniforms).toEqual({
      progress: 0,
      scale: 0,
      edge: 0,
      edgeColor: new Float32Array(3)
    });
  });
});

describe("markTransition", () => {
  // Bug: the mark wraps the component in another object: the world and the listing no longer know it.
  it("returns the component it was given, and records its kind and member for its definition", () => {
    const Tint = defineFilter("fixture.mark", {
      wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(0.0); }",
      glsl: "void main() { finalColor = vec4(0.0); }"
    });

    expect(transitionMarkOf(Tint.filter)).toBeUndefined();
    expect(markTransition(Tint, "iris", "Tint")).toBe(Tint);
    expect(transitionMarkOf(Tint.filter)).toEqual({ kind: "iris", member: "Tint" });
  });
});
