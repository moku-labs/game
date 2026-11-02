import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { Sprite, Transform } from "../../../renderer/components";
import type { FilterSlot } from "../../../renderer/types";
import type { AnyComponentValue, Entity } from "../../../world/types";
import { Alpha, Blur, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { type FakeFxFilter, FakeFxGpuProgram } from "../fake-effects-pixi";
import { Small, Soft, SoftDim, Veiled } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the seam of the quad (F126 stage 2). The effects plugin checks a
// kind's quad program with its shader and hands it over the slot and the warm-up,
// built once. A body that cannot move, a quad that failed its check and a
// stand-in hand none: their views keep today's path.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A body with one uniform, the plain signature. */
const BODY =
  "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.amount; }";

/** The GLSL twin. */
const GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord) * amount; }";

/** A plain filter of ours with a uniform. */
const Tint = defineFilter("fx.quadTint", { wgsl: BODY, glsl: GLSL, uniforms: { amount: 1 } });

/** A plain filter of ours with no uniform of its own. */
const Bare = defineFilter("fx.quadBare", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord); }"
});

/** A body that calls `canvasPixel`: the engine's `keptOrigin` joins its group. */
const Placed = defineFilter("fx.quadPlaced", {
  wgsl: "fn at(uv: vec2<f32>) -> vec2<f32> { return canvasPixel(uv) * fu.amount; }\n@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(at(uv), 0.0, 1.0); }",
  glsl: "void main() { finalColor = vec4(canvasPixel(vTextureCoord) * amount, 0.0, 1.0); }",
  uniforms: { amount: 1 }
});

/** A body the rewrite does not fit. */
const Position = defineFilter("fx.quadPosition", {
  wgsl: "@fragment fn mainFragment(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> { return at; }",
  glsl: "void main() { finalColor = vec4(0.0); }",
  cache: false
});

/** What a fake compiler says about a text that does not compile. */
const BAD = [{ type: "error", lineNum: 41, linePos: 3, message: "bad" }] as const;

/** A kind a test breaks through its check, with a fallback that passes its own. */
const Broken = defineFilter("fx.quadBroken", {
  wgsl: `// broken\n${BODY}`,
  glsl: GLSL,
  uniforms: { spread: 1 },
  fallback: SoftDim
});

/** Lets the compilation info resolve, the quad's after the shader's. */
async function settle(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

/**
 * A started mock on WebGPU with the device the WGSL check compiles on, its checks answered.
 *
 * @param filters - The filters of the one feature.
 * @param fails - The texts that do not compile.
 * @returns The mock.
 */
async function checked(
  filters: readonly FeatureFilter[],
  fails: readonly (string | undefined)[] = []
): Promise<MockEffects> {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  mock.gpu.answer = code => (fails.includes(code) ? [...BAD] : []);
  mock.features.push({ name: "fx", description: { filters } });
  mock.start();
  mock.frame();
  await settle();

  return mock;
}

/**
 * Spawns a view with a display object and its filters, and syncs it.
 *
 * @param mock - The mock.
 * @param components - The filter components.
 * @returns The entity.
 */
function view(mock: MockEffects, components: readonly AnyComponentValue[]): Entity {
  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), ...components]);

  mock.renderer.displays.add(entity);
  mock.frame();

  return entity;
}

/**
 * The slots of the last hand-over.
 *
 * @param mock - The mock.
 * @returns The slots.
 */
function lastSlots(mock: MockEffects): readonly FilterSlot[] {
  return mock.renderer.sets.at(-1)?.slots ?? [];
}

/**
 * The programs built for quad text: not a filter's own, whose fragment source is its `source`.
 *
 * @param source - The quad text.
 * @returns The programs built from it.
 */
function quadPrograms(source: string | undefined): FakeFxGpuProgram[] {
  return FakeFxGpuProgram.made.filter(
    program => (program.options.fragment as { source: string }).source === source
  );
}

/**
 * The members of the struct a quad program declares at group 3, in order.
 *
 * @param source - The quad text.
 * @returns The names.
 */
function membersOf(source = ""): string[] {
  const start = source.indexOf("struct FilterUniforms {");
  const lines = source.slice(start, source.indexOf("};", start)).split("\n").slice(1);

  return lines.map(line => line.trim().split(":")[0] ?? "").filter(name => name !== "");
}

/**
 * The uniform names of an instance's group, in the order the group holds them.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @param id - The kind id.
 * @returns The names.
 */
function groupOf(mock: MockEffects, entity: Entity, id: string): string[] {
  const instance = mock.state.views.get(entity)?.instances.get(id);

  return Object.keys((instance?.kind === "wgsl" ? instance.group?.uniforms : undefined) ?? {});
}

/**
 * The quad handed with the probe of one definition.
 *
 * @param mock - The mock, its probes handed.
 * @param id - The definition id.
 * @returns The probe's filter was handed with a quad, without one, or never.
 */
function handedWith(mock: MockEffects, id: string): "quad" | "alone" | "never" {
  const at = mock.renderer.warms.findIndex(filter => {
    const program = (filter as unknown as FakeFxFilter).options.gpuProgram;

    return (program as { options?: { name?: string } } | undefined)?.options?.name === id;
  });

  if (at === -1) return "never";

  return mock.renderer.warmQuads[at] === undefined ? "alone" : "quad";
}

describe("the quad over the slot", () => {
  // Bug: the renderer finds no program, and the view pays a stage 3 pass in every frame.
  it("hands the program and the instance's group for a plain filter of ours", async () => {
    const mock = await checked([Tint]);

    view(mock, [Tint()]);

    const quad = lastSlots(mock)[0]?.quad;
    const filter = lastSlots(mock)[0]?.filter as unknown as FakeFxFilter;

    expect(quad?.program).toBe(quadPrograms(Tint.filter.quadSource)[0]);
    expect(quad?.fu).toBe(filter.resources.fu);
  });

  // Bug: a `fu` key of `undefined` throws in Pixi's `Shader`, or a group nobody bound leaves the mesh blank.
  it("hands no group for a filter that binds none", async () => {
    const mock = await checked([Bare]);

    view(mock, [Bare()]);

    expect(lastSlots(mock)[0]?.quad?.program).toBeDefined();
    expect(lastSlots(mock)[0]?.quad?.fu).toBeUndefined();
  });

  // Bug: a shader that asks for more than the group holds: a blank view with no error at all.
  it.each([
    ["without canvasPixel", Tint],
    ["with canvasPixel", Placed]
  ])("declares the members of the instance's group, %s", async (_name, kind) => {
    const mock = await checked([kind]);
    const entity = view(mock, [kind()]);
    const members = groupOf(mock, entity, kind.filter.id);

    expect(members.length).toBeGreaterThan(0);
    expect(membersOf(kind.filter.quadSource)).toEqual(members);
  });

  // Bug: a body that reads a second texture, or that the wrapper cannot call, is moved to the mesh.
  it.each([
    ["with inputs", Soft, () => Soft()],
    ["a body the rewrite does not fit", Position, () => Position()],
    ["a core kind", undefined, () => Blur({ strength: 4 })],
    ["an Alpha", undefined, () => Alpha({ alpha: 0.5 })]
  ])("hands none %s", async (_name, kind, value) => {
    const mock = await checked(kind === undefined ? [] : [kind]);

    view(mock, [value()]);

    expect(lastSlots(mock)).toHaveLength(1);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
  });

  // Bug: WebGL builds a program nothing draws, and a slot promises a mesh it cannot have.
  it("hands none on WebGL", async () => {
    const mock = createMockEffects();

    mock.renderer.kind = "webgl";
    mock.renderer.gl = mock.gl.context;
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    view(mock, [Tint()]);

    expect(lastSlots(mock)).toHaveLength(1);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
    expect(quadPrograms(Tint.filter.quadSource)).toEqual([]);
  });

  // Bug: a quad nobody compiled reaches the GPU after a device came back.
  it("hands none when the check had no device to compile on", async () => {
    const mock = createMockEffects();

    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    view(mock, [Tint()]);

    expect(lastSlots(mock)).toHaveLength(1);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
  });

  // Bug: a broken kind loses its stripe: the mesh path never runs `apply`. The fallback is a kind here, so its quad passed.
  it.each([
    ["a stand-in", false],
    ["a stand-in under the dev mark", true]
  ])("hands none on %s", async (_name, dev) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", dev);

    const mock = await checked([Broken, SoftDim], [Broken.filter.source]);

    view(mock, [Broken()]);

    expect(mock.state.checks.quads.has(SoftDim.filter)).toBe(true);
    expect(lastSlots(mock)).toHaveLength(1);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
  });

  // Bug: the renderer builds its shader again at every relist: `shade.quad` is compared by identity.
  it("keeps the same quad object through a relist of the instance", async () => {
    const mock = await checked([Tint]);
    const entity = view(mock, [Tint()]);
    const before = lastSlots(mock)[0]?.quad;

    mock.world.ecs.add(entity, Glow());
    mock.frame();

    const after = lastSlots(mock).find(slot => slot.quad?.program === before?.program);

    expect(mock.renderer.sets).toHaveLength(2);
    expect(after?.quad).toBe(before);
  });

  // Bug: a slot keeps a program the instance no longer hands over: the renderer shades what it should not.
  it("hands a new list when what the instance hands over changed", async () => {
    const mock = await checked([Tint]);
    const entity = view(mock, [Tint()]);

    expect(lastSlots(mock)[0]).toHaveProperty("quad");

    mock.state.checks.quads.delete(Tint.filter);
    mock.world.ecs.set(entity, Tint, { amount: 0.5 });
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(2);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
  });

  // Bug: a write of a value hands a new list, and a kept view churns to live in every frame it animates.
  it("hands no new list for a write of a value", async () => {
    const mock = await checked([Tint]);
    const entity = view(mock, [Tint()]);

    mock.world.ecs.set(entity, Tint, { amount: 0.5 });
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(1);
  });

  // Bug: a key of the whole source, about 10 KB, on every instance: `GpuProgram.from` builds one on every call.
  it("builds the program of a kind once, for two instances", async () => {
    const mock = await checked([Tint]);

    view(mock, [Tint()]);
    view(mock, [Tint()]);

    const slots = mock.renderer.sets.map(set => set.slots[0]?.quad?.program);

    expect(quadPrograms(Tint.filter.quadSource)).toHaveLength(1);
    expect(slots).toEqual([slots[0], slots[0]]);
  });
});

describe("the quad in the check", () => {
  // Bug: a bad quad text breaks a filter that draws.
  it("logs one line for a quad that fails, keeps the kind ok and hands no quad", async () => {
    const mock = await checked([Tint], [Tint.filter.quadSource]);

    mock.gpu.answer = () => [];

    view(mock, [Tint()]);

    const lines = vi.mocked(mock.log.error).mock.calls.filter(([name]) => name === "effects:wgsl");

    expect(lines).toEqual([
      ["effects:wgsl", { filter: Tint.filter.id, quad: true, line: 41, column: 3, message: "bad" }]
    ]);
    expect(mock.state.checks.status.get(Tint.filter)).toBe("ok");
    expect(mock.state.broken.has(Tint.filter.id)).toBe(false);
    expect(lastSlots(mock)).toHaveLength(1);
    expect(lastSlots(mock)[0]).not.toHaveProperty("quad");
  });

  // Bug: a run of error lines for one text: the owner reads them as several filters broken.
  it("logs one line however many errors the quad has", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.answer = code => (code === Tint.filter.quadSource ? [...BAD, ...BAD] : []);
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();

    expect(mock.log.error).toHaveBeenCalledOnce();
  });

  // Bug: the same error logged twice for one body, as a shader and as its quad.
  it("does not compile the quad of a body that failed", async () => {
    const mock = await checked([Tint], [Tint.filter.source]);

    expect(mock.gpu.compiled).not.toContain(Tint.filter.quadSource);
    expect(mock.log.error).toHaveBeenCalledWith("effects:wgsl", expect.anything());
    expect(mock.state.checks.quads.has(Tint.filter)).toBe(false);
  });

  // Bug: the check pays for shaders nothing can draw on a mesh: `effects:checks` is a gate of the plan.
  it("compiles the quad of a kind only: not of a stage, not of a fallback", async () => {
    const mock = await checked([Soft, Veiled]);

    expect(mock.gpu.compiled).not.toContain(Small.filter.quadSource);
    expect(mock.gpu.compiled).not.toContain(SoftDim.filter.quadSource);
    expect(mock.gpu.compiled.filter(code => code === Glow.filter.quadSource)).toHaveLength(1);
  });

  // Bug: the first view is built before the quad answered, its slot has no quad, and no later sync hands one.
  it("keeps the kind pending until its quad answered", async () => {
    const held = Promise.withResolvers<void>();
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.waits.set(Tint.filter.quadSource ?? "", held.promise);
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();

    expect(mock.state.checks.status.get(Tint.filter)).toBe("pending");

    held.resolve();
    await settle();

    expect(mock.state.checks.status.get(Tint.filter)).toBe("ok");
  });

  // Bug: a device lost between the two compiles throws out of the check, and the kind never answers.
  it("answers ok with no quad when the device went between the two compiles", async () => {
    const held = Promise.withResolvers<void>();
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.waits.set(Tint.filter.source, held.promise);
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    mock.renderer.device = undefined;
    held.resolve();
    await settle();

    expect(mock.state.checks.status.get(Tint.filter)).toBe("ok");
    expect(mock.state.checks.quads.has(Tint.filter)).toBe(false);
  });

  // Bug: a quad whose answer could not be read counts as compiled, and an unchecked text reaches the GPU.
  it("hands no quad when its compile info cannot be read", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.answer = code => {
      if (code === Tint.filter.quadSource) throw new Error("lost");

      return [];
    };
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();

    expect(mock.state.checks.status.get(Tint.filter)).toBe("ok");
    expect(mock.state.checks.quads.has(Tint.filter)).toBe(false);
  });

  // Bug: an answer of a stopped run adds a quad to the next run, or logs for a game that left.
  it("ignores a quad's answer from before a stop", async () => {
    const held = Promise.withResolvers<void>();
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.answer = code => (code === Tint.filter.quadSource ? [...BAD] : []);
    mock.gpu.waits.set(Tint.filter.quadSource ?? "", held.promise);
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();
    mock.stop();
    held.resolve();
    await settle();

    expect(mock.log.error).not.toHaveBeenCalled();
    expect(mock.state.checks.quads.has(Tint.filter)).toBe(false);
  });
});

describe("the quad in the warm-up", () => {
  // Bug: 40 pipelines at load that nothing uses, or a kind's first quad compiled in play.
  it("hands a kind's filter with its quad, a stage and a fallback alone", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.renderer.warmAnswer = "later";
    mock.features.push({ name: "fx", description: { filters: [Tint, Soft, Veiled] } });
    mock.start();
    mock.frame();
    await settle();

    expect(handedWith(mock, Tint.filter.id)).toBe("quad");
    expect(handedWith(mock, Soft.filter.id)).toBe("alone");
    expect(handedWith(mock, Small.filter.id)).toBe("alone");
    expect(handedWith(mock, SoftDim.filter.id)).toBe("alone");
  });

  // Bug: a probe's quad binds the uniform group of nothing: the warm-up's mesh throws.
  it("binds the probe's own group", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.renderer.warmAnswer = "later";
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();

    const at = mock.renderer.warmQuads.findIndex(
      quad => quad?.program === quadPrograms(Tint.filter.quadSource)[0]
    );
    const filter = mock.renderer.warms[at] as unknown as FakeFxFilter;

    expect(mock.renderer.warmQuads[at]?.fu).toBe(filter.resources.fu);
  });

  // Bug: a kind that is also another kind's fallback is warmed as the fallback, and its first quad compiles in play.
  it("hands the quad of a kind that is also a fallback of an earlier kind", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.renderer.warmAnswer = "later";
    mock.features.push({ name: "fx", description: { filters: [Veiled, SoftDim] } });
    mock.start();
    mock.frame();
    await settle();

    expect(handedWith(mock, SoftDim.filter.id)).toBe("quad");
  });

  // Bug: a failed quad reaches the warm-up, whose scope logs a fault the check already reported.
  it("hands a kind whose quad failed alone", async () => {
    const mock = createMockEffects();

    mock.renderer.device = mock.gpu.device;
    mock.renderer.warmAnswer = "later";
    mock.gpu.answer = code => (code === Tint.filter.quadSource ? [...BAD] : []);
    mock.features.push({ name: "fx", description: { filters: [Tint] } });
    mock.start();
    mock.frame();
    await settle();

    expect(handedWith(mock, Tint.filter.id)).toBe("alone");
  });
});
