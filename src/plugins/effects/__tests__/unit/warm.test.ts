import { describe, expect, it } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { Glow, Outline } from "../../filters/builtins";
import { createWarmFilter } from "../../filters/instance";
import { checksSettled, warmDefinitions } from "../../filters/warm";
import {
  FakeFxAlphaFilter,
  FakeFxBlurFilter,
  FakeFxColorMatrixFilter,
  FakeFxDisplacementFilter,
  type FakeFxFilter,
  FakeFxGpuProgram,
  FakeFxNoiseFilter
} from "../fake-effects-pixi";
import { Along, Bad, Hazy, Small, Smaller, Soft, SoftDim, Veiled } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the warm hooks spec 27 builds its probes from. The checks settle
// after the last answer; the list holds every definition an instance can draw
// whose check answered ok, each once, and none that failed.
// ---------------------------------------------------------------------------

/** Lets the compilation info resolve. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/**
 * A started mock on WebGPU with the device the WGSL check compiles on; `Bad` does not compile.
 *
 * @param filters - The filters of the one feature.
 * @returns The mock.
 */
function started(filters: readonly FeatureFilter[]): MockEffects {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  mock.gpu.answer = code =>
    code === Bad.filter.source ? [{ type: "error", lineNum: 1, linePos: 1, message: "bad" }] : [];
  mock.features.push({ name: "fixture", description: { filters } });
  mock.start();

  return mock;
}

describe("the warm hooks", () => {
  it("settles after the last answer, not before", async () => {
    const held = Promise.withResolvers<void>();
    let settled = false;
    const mock = started([Soft]);

    mock.gpu.waits.set(Along.filter.source, held.promise);
    checksSettled(mock.ectx).then(() => {
      settled = true;
    });
    mock.frame();
    await settle();

    expect(settled).toBe(false);

    held.resolve();
    await settle();

    expect(settled).toBe(true);
  });

  it("lists every checked definition once, in check order, and none that failed", async () => {
    const mock = started([Soft, Veiled, Hazy]);

    mock.frame();
    await settle();

    expect(
      warmDefinitions(mock.ectx).map(entry => [entry.definition.id, entry.role, entry.kind])
    ).toEqual([
      [Glow.filter.id, "kind", "effects.glow"],
      [Outline.filter.id, "kind", "effects.outline"],
      [Soft.filter.id, "kind", "fixture.soft"],
      [Small.filter.id, "stage", "fixture.soft"],
      [Smaller.filter.id, "stage", "fixture.soft"],
      [Along.filter.id, "stage", "fixture.soft"],
      [Veiled.filter.id, "kind", "fixture.veiled"],
      [SoftDim.filter.id, "fallback", "fixture.veiled"]
    ]);
  });

  it("builds a probe over the definition's programs, its inputs bound to the empty texture, and destroys it", () => {
    const mock = started([Soft]);
    const probe = createWarmFilter(mock.pixi.module, Soft.filter);
    const filter = probe.filter as unknown as FakeFxFilter;

    expect(filter.resources.softTexture).toBe(mock.pixi.module.Texture.EMPTY.source);
    expect(
      (filter.options.gpuProgram as { options: { fragment: { source: string } } }).options.fragment
        .source
    ).toBe(Soft.filter.source);

    probe.destroy();

    expect(filter.destroyed).toBe(true);
  });
});

/** The Pixi-core kinds in registration order, as the hand-over names them. */
const CORE = ["blur", "colorMatrix", "noise", "displacement", "alpha"];

/**
 * Names a filter handed to the renderer: the definition id of one of ours, the kind of a Pixi-core one.
 *
 * @param filter - The handed filter.
 * @returns Its name.
 */
function nameOf(filter: unknown): string {
  if (filter instanceof FakeFxBlurFilter) return "blur";
  if (filter instanceof FakeFxColorMatrixFilter) return "colorMatrix";
  if (filter instanceof FakeFxNoiseFilter) return "noise";
  if (filter instanceof FakeFxDisplacementFilter) return "displacement";
  if (filter instanceof FakeFxAlphaFilter) return "alpha";

  const program = (filter as FakeFxFilter).options.gpuProgram as { options: { name: string } };

  return program.options.name;
}

/**
 * The names of every filter handed to `renderer.sync.filters.warm`, in order.
 *
 * @param mock - The mock.
 * @returns The names.
 */
function handed(mock: MockEffects): string[] {
  return mock.renderer.warms.map(filter => nameOf(filter));
}

describe("the warm-up hand-over (spec 27 F4)", () => {
  // Bug: a probe of an unchecked shader is drawn: a broken program in the splash's first frame.
  it("nothing is handed over before the checks settled", async () => {
    const held = Promise.withResolvers<void>();
    const mock = started([Soft]);

    mock.renderer.warmAnswer = "later";
    mock.gpu.waits.set(Along.filter.source, held.promise);
    mock.frame();
    await settle();

    expect(mock.renderer.warms).toEqual([]);

    held.resolve();
    await settle();

    expect(handed(mock)).toContain(Soft.filter.id);
  });

  // Bug: a stage or a fallback is never warmed, and the first sheet compiles it in the frame it opens in.
  it("every definition warmDefinitions lists is handed over once, in its order: bodies, stages and fallbacks", async () => {
    const mock = started([Soft, Veiled, Hazy]);

    mock.renderer.warmAnswer = "later";
    mock.frame();
    await settle();
    mock.frame();
    await settle();

    expect(handed(mock)).toEqual([
      ...CORE,
      ...warmDefinitions(mock.ectx).map(entry => entry.definition.id)
    ]);
    expect(handed(mock).slice(5)).toEqual([
      Glow.filter.id,
      Outline.filter.id,
      Soft.filter.id,
      Small.filter.id,
      Smaller.filter.id,
      Along.filter.id,
      Veiled.filter.id,
      SoftDim.filter.id
    ]);
  });

  // Bug: the probe of a shader that does not compile is drawn; or a broken kind's fallback is cold the day it is needed.
  it("a definition that failed its check is never handed over; a broken kind's fallback is", async () => {
    const mock = started([Hazy]);

    mock.renderer.warmAnswer = "later";
    mock.frame();
    await settle();

    expect(handed(mock)).toEqual([...CORE, Glow.filter.id, Outline.filter.id, SoftDim.filter.id]);
    expect(handed(mock)).not.toContain(Bad.filter.id);
    expect(handed(mock)).not.toContain(Hazy.filter.id);
  });

  // Bug: a Displacement probe waits for a map that no screen has loaded yet, and its pipeline is never warmed.
  it("every Pixi-core kind is handed over with its defaults, a Displacement without its map", async () => {
    const mock = started([]);

    mock.renderer.warmAnswer = "later";
    mock.frame();
    await settle();

    const blur = mock.renderer.warms.find(filter => filter instanceof FakeFxBlurFilter);
    const displacement = mock.renderer.warms.find(
      filter => filter instanceof FakeFxDisplacementFilter
    ) as unknown as FakeFxDisplacementFilter | undefined;

    expect(handed(mock).slice(0, 5)).toEqual(CORE);
    // The defaults of Blur: strength 8.
    expect((blur as unknown as FakeFxBlurFilter).strength).toBe(8);
    expect(displacement?.sprite.texture).toBe(FakeTexture.WHITE);
  });

  // Bug: the Alpha probe is built at its default alpha 1 and switched off like any Alpha at 1: Pixi skips it, and its
  // pipeline compiles in the frame of the first fade.
  it("the Alpha probe is handed over switched on, though its default alpha is 1", async () => {
    const mock = started([]);

    mock.renderer.warmAnswer = "later";
    mock.frame();
    await settle();

    const alpha = mock.renderer.warms.find(filter => filter instanceof FakeFxAlphaFilter);

    expect(alpha?.enabled).toBe(true);
  });

  // Bug: with nothing to warm (warm: 0) every probe is built, a program compiled for each, and kept for the app's life.
  it("when the renderer has nothing to warm the probe is destroyed and no further probe is built", async () => {
    const mock = started([Soft]);

    mock.frame();

    // The checks compiled their modules; from here on, only the probes could build a program.
    const programs = FakeFxGpuProgram.made.length;

    await settle();

    expect(handed(mock)).toEqual(["blur"]);
    expect((mock.renderer.warms[0] as unknown as FakeFxBlurFilter).destroyed).toBe(true);
    // No program of a game's shader was built for the probes.
    expect(FakeFxGpuProgram.made).toHaveLength(programs);
    expect(mock.state.warm.probes).toEqual([]);

    mock.frame();
    await settle();

    expect(mock.renderer.warms).toHaveLength(1);
  });

  // Bug: the probes outlive the app, with their uniform buffers.
  it("the probes are destroyed when the app stops", async () => {
    const mock = started([Soft]);

    mock.renderer.warmAnswer = "later";
    mock.frame();
    await settle();

    const probes = [...mock.renderer.warms] as unknown as FakeFxFilter[];

    expect(probes.length).toBeGreaterThan(5);
    expect(probes.some(probe => probe.destroyed)).toBe(false);

    mock.stop();

    expect(probes.every(probe => probe.destroyed)).toBe(true);
    expect(mock.state.warm).toEqual({ started: false, core: [], probes: [] });
  });
});
