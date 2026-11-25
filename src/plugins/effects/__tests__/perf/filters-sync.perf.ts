import { describe, expect, it } from "vitest";
import { Glow } from "../../filters/builtins";
import type { FilterFields } from "../../filters/types";
import { Bloom } from "../../set/bloom";
import { Flash } from "../../set/flash";
import { Frost } from "../../set/frost";
import { Pixelate } from "../../set/pixelate";
import { Wave } from "../../set/wave";
import { BUDGET, NOISE } from "./budgets";
import {
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  bytesPerCall,
  CROSSING,
  FLASH_AMOUNT,
  FROST_BLUR,
  fadeStep,
  fadeWrite,
  filtersFixture,
  HALF,
  keyedTweenStep,
  PIXELATE_SIZE,
  RESTING,
  tweenStep,
  tweenWrite,
  WAVE_PHASE
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the filter sync of `effects` (change 2026-10-18-cheap-idle-tick, E1) — 12 filtered views with
// nothing changed, one uniform tweened on one of them, and one Alpha fading (change 2026-10-18-memory-render, M4).
// ---------------------------------------------------------------------------

describe("effects:filters, heap bytes per frame step", () => {
  it("12 filtered views, nothing changed", () => {
    const { run } = filtersFixture();

    expect(bytesPerCall(run)).toBeLessThanOrEqual(BUDGET.filtersIdle + NOISE);
  });

  it("one Glow strength tweened on one of 12 filtered views", () => {
    const fixture = filtersFixture();
    const step = bytesPerCall(tweenStep(fixture));
    // The tween's own write of a fraction into the stored value: not the sync's bytes.
    const write = bytesPerCall(tweenWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });

  // Bug it guards: the look-up of the quad, asked at every sync of a view that writes its numbers, allocates per frame.
  it("one Glow strength tweened on one of 12 filtered views, its quad handed over", () => {
    const fixture = filtersFixture([Glow.filter]);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));

    expect(fixture.mock.renderer.sets.some(set => set.slots[0]?.quad !== undefined)).toBe(true);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });

  // Bug it guards: a member of the effect set allocates per frame of a tween where a game's own filter does not.
  it("one Flash amount tweened on one of 12 filtered views, its quad handed over", () => {
    const fixture = filtersFixture([Flash.filter], FLASH_AMOUNT);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));
    const handed = fixture.mock.renderer.sets.filter(set => set.entity === fixture.tweened);

    expect(handed.some(set => set.slots[0]?.quad !== undefined)).toBe(true);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });

  // Bug it guards: a member of stage 4 allocates per frame of its loop: a `Wave` whose phase flows for as long as a scene
  // is open, on its quad.
  it("one Wave phase tweened on one of 12 filtered views, its quad handed over", () => {
    const fixture = filtersFixture([Wave.filter], WAVE_PHASE);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));
    const handed = fixture.mock.renderer.sets.filter(set => set.entity === fixture.tweened);

    expect(handed.some(set => set.slots[0]?.quad !== undefined)).toBe(true);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });

  // Bug it guards: the sync reads a stored number field V8 keeps as a raw double (a `Pixelate`'s one `size`) by the
  // uniform's name, and every read hands back a new box: 16 B at the compare and 16 at the write, per frame.
  it("one Pixelate size tweened on one of 12 filtered views, its quad handed over", () => {
    const fixture = filtersFixture([Pixelate.filter], PIXELATE_SIZE);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));
    const handed = fixture.mock.renderer.sets.filter(set => set.entity === fixture.tweened);

    expect(handed.some(set => set.slots[0]?.quad !== undefined)).toBe(true);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });

  // Bug it guards: the chain of a member makes its ladder per call: a strength tween runs the chain in every frame.
  it("the chain of Bloom, called as a tween calls it, both ladders", () => {
    const chain = Bloom.filter.inputs[0]?.chain;
    const value: Record<string, number | boolean> = { ...Bloom().value };
    const context = { resolution: 2 };
    let frame = 0;

    if (chain === undefined) throw new Error("Bloom reads no input");

    const call = (): void => {
      frame += 1;
      // Small integers, so the write of the radius boxes nothing: radius 16 takes the ladder at ¼, 32 the one at ⅛.
      value.radius = (frame & 1) === 0 ? 16 : 32;
      chain(value as FilterFields, context);
    };

    expect(bytesPerCall(call)).toBeLessThanOrEqual(BUDGET.bloomChain + NOISE);
  });

  // Bug it guards: the names of the quad's input made per sync, or the engine's walk of a chain's answer (its inputs,
  // steps and places) allocates per frame of a tween.
  it("one Bloom strength tweened on one of 12 filtered views, its quad handed over with its input named", () => {
    const fixture = filtersFixture([Bloom.filter], BLOOM_STRENGTH);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));
    const handed = fixture.mock.renderer.sets.filter(set => set.entity === fixture.tweened);

    expect(handed.some(set => set.slots[0]?.inputs?.count === 1)).toBe(true);
    expect(handed.some(set => set.slots[0]?.quad?.inputNames?.length === 2)).toBe(true);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersBloomTween + NOISE);
  });

  // Bug it guards (B2): a tween that changes a chain's steps (the blur's sigma) folds the steps into a key through
  // strings, arrays and a join in every frame, in every game, though only a window over a Source ever reads it.
  it("one Bloom radius tweened on one of 12 filtered views, its quad handed over", () => {
    const fixture = filtersFixture([Bloom.filter], BLOOM_RADIUS);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersChainTween + NOISE);
  });

  // Bug it guards (B2): the same for a `Frost` on today's backdrop path, no Source under it.
  it("one Frost blur tweened on one of 12 filtered views, on the backdrop path", () => {
    const fixture = filtersFixture([], FROST_BLUR);
    const step = bytesPerCall(tweenStep(fixture));
    const write = bytesPerCall(tweenWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersChainTween + NOISE);
  });

  // Bug it guards (B2): over a Source the renderer asks the key at every step change; the key is folded from the steps
  // with no string, array or join, the definition's id hashed once.
  it("one Frost blur tweened on one of 12 filtered views, its key asked as over a Source", () => {
    const fixture = filtersFixture([Frost.filter], FROST_BLUR);
    const step = bytesPerCall(keyedTweenStep(fixture, 0.5));
    const write = bytesPerCall(tweenWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersChainTween + NOISE);
  });

  // Bug it guards: the steady pass-budget count (F117) boxed its frames or made a record per frame over the budget.
  it("12 filtered views, nothing changed, the render passes over the budget", () => {
    const { run, mock } = filtersFixture();

    mock.renderer.passes = 30;

    expect(bytesPerCall(run)).toBeLessThanOrEqual(BUDGET.filtersIdle + NOISE);
  });

  it.each([
    ["touching 1 in every other step: its filter stays on", CROSSING, BUDGET.filtersFadeCrossing],
    [
      "resting at 1 until its filter is switched off, then fading in",
      RESTING,
      BUDGET.filtersFadeResting
    ],
    ["at resolution 0.5", HALF, BUDGET.filtersFadeHalf]
  ] as const)("one Alpha of 12 filtered views fading, %s", (_name, fade, budget) => {
    const fixture = filtersFixture();
    const asked = fixture.counter.invalidated;
    const step = bytesPerCall(fadeStep(fixture, fade));
    // The fade's own write of the alpha into the stored value: not the sync's bytes.
    const write = bytesPerCall(fadeWrite(fixture, fade));

    // The moves of the fade are drawn: the renderer was asked for their frames.
    expect(fixture.counter.invalidated).toBeGreaterThan(asked);
    expect(step - write).toBeLessThanOrEqual(budget + NOISE);
  });
});
