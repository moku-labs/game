import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { HudPart } from "../../components";
import { withDeps } from "../../lifecycle";
import { stepParts } from "../../sync/overlay-look";
import type { SyncCtx } from "../../sync/types";
import { startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Cold perf (change 2026-11-24-f230-hot-path, step 0 and R1): what `stepParts` allocates while V8 runs it in the
// interpreter or the baseline tier (`--max-opt=1`), as a phone runs it in its first seconds. A `for…of` costs an
// iterator and its result objects there; an index loop over a list, or `forEach` with a callback made once, costs none.
// Measured on Node 24.21, 2 overlays and 6 HUD parts:
//   stepParts before R1            2248 B per call (the `for…of` over the Set of parts: 320 B; the `for…of` over the
//                                  overlay order in `factorOf`, `targetOf` and `inertOf` per part and in
//                                  `holdsSame` over the faded tops: a bare `for…of` over the 2 overlays is 168 B and
//                                  over the faded tops 328 B, the rest of the 2248 B)
//   stepParts after R1                0 B per call
//   a bare `for…of` over the Set    320 B per call
//   a bare `for…of` over an array   327 B per call
//   the same walk with an index       0 B per call
// ---------------------------------------------------------------------------

/** What `stepParts` costs after R1, cold, plus 16 B of margin. A fix lowers this number, never raises it. */
const STEP_PARTS_COLD = 16;

/** What a bare `for…of` over the set of 6 parts costs, cold, plus 16 B of margin. */
const SET_WALK_COLD = 336;

/** What a bare `for…of` over an array of 6 parts costs, cold, plus 16 B of margin. */
const ARRAY_WALK_COLD = 344;

/** What the same walk with an index costs, cold, plus 8 B of margin. */
const INDEX_WALK_COLD = 8;

/**
 * A resting scene: 20 views of the ward, 6 HUD parts, and two landed overlays (a dim that keeps `part0`, and a sheet
 * that keeps `part1` inert), so the step fades, holds and applies parts. The frames that build it have run.
 *
 * @returns The sync context `stepParts` takes, and the HUD parts it walks.
 */
async function restingParts(): Promise<{ sctx: SyncCtx; parts: readonly number[] }> {
  const stage = await startOverlayStage();
  const { mock } = stage.drawn;

  for (let index = 0; index < 20; index += 1) {
    stage.view({ layer: "scene", x: (index % 5) * 200, y: Math.floor(index / 5) * 200 });
  }

  for (let index = 0; index < 6; index += 1) {
    stage.view({ layer: "hud", x: index * 120, extra: [HudPart({ key: `part${index}` })] });
  }

  const shop = stage.overlay({ dim: 0.56, hud: ["part0"] }, { order: 2 });
  const sheet = stage.overlay({ dim: 0.3, hud: ["part0", "part1"], hudInert: true }, { order: 3 });

  stage.level(shop, 1, true);
  stage.level(sheet, 1, true);
  stage.frames(3);

  const { overlay } = mock.ctx.state.sync;
  const { host, viewport, demand, kept } = mock.modules;

  if (overlay.parts.size !== 6 || overlay.offTops.size === 0) {
    throw new Error(
      "perf fixture: the resting scene does not hold 6 HUD parts, some of them faded"
    );
  }

  return {
    sctx: { ctx: withDeps(mock.ctx), deps: { host, viewport, demand, kept } },
    parts: [...overlay.parts]
  };
}

/** Where the walks below leave the entity they read: a small whole number, so the store boxes nothing. */
const sink = { last: 0 };

describe("stepParts, run unoptimized", () => {
  it("stays within what it costs today", async () => {
    const { sctx } = await restingParts();

    expect(
      allocCold(() => {
        stepParts(sctx);
      })
    ).toBeLessThanOrEqual(STEP_PARTS_COLD);
  });

  it("is beaten by the walks of its own loop: for…of builds an iterator, an index builds nothing", async () => {
    const { parts } = await restingParts();
    const set = new Set(parts);

    expect(
      allocCold(() => {
        for (const entity of set) sink.last = entity;
      })
    ).toBeLessThanOrEqual(SET_WALK_COLD);
    expect(
      allocCold(() => {
        for (const entity of parts) sink.last = entity;
      })
    ).toBeLessThanOrEqual(ARRAY_WALK_COLD);
    expect(
      allocCold(() => {
        for (let index = 0; index < parts.length; index += 1) sink.last = parts[index] ?? 0;
      })
    ).toBeLessThanOrEqual(INDEX_WALK_COLD);
  });
});
