import { describe, expect, it } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { Glow, Outline } from "../../filters/builtins";
import { createWarmFilter } from "../../filters/instance";
import { checksSettled, warmDefinitions } from "../../filters/warm";
import type { FakeFxFilter } from "../fake-effects-pixi";
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
