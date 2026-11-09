import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerSpec } from "../../../world/types";
import { type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit: a layer loader of a scene being left (spec 33, slice A2) under an overlay's freeze range (spec 22). The loader's
// layer lies below the overlay's layer, as in a scene that declares it first: under the root it is part of the range.
// Lifted above the veil it is the look's, and no range may hide it.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) stage.drawn.mock.stop();
  vi.unstubAllGlobals();
});

/** The scene left and the next one: the loader's layer first, the overlays' layer above it. */
const LAYERS: readonly LayerSpec[] = [
  { name: "loading", sort: "none" },
  { name: "ui", sort: "order" },
  { name: "hud", sort: "none", above: "overlays" }
];

/** A veil that fades in over 100 ms and out over 600 ms. */
const VEIL = { color: 0x10_20_30, alpha: 0.6, inMs: 100, outMs: 600 };

describe("a lifted layer loader under a freezing overlay", () => {
  // Bug F161: at the swap the next scene's layer list takes the lifted loader layer back under the root for the rest of
  // the pass; the overlay step of that frame puts it into its freeze range as a lower layer, and the leave step lifts it
  // again still hidden: the loader drops out for one frame, and the sharp scene flashes between two blurred frames.
  it("stays drawn above the veil in every frame of the fade-out", async () => {
    const stage = await startOverlayStage({ onDemand: false });
    const { mock } = stage.drawn;

    running.push(stage);
    mock.world.projection.setLayers(LAYERS);
    stage.view({ layer: "loading" });
    stage.view({ layer: "ui", order: 1 });
    stage.frames(2);

    const loading = stage.layer("loading");

    mock.setNow(0);
    mock.api.sync.leave.show({ cover: VEIL, loader: { afterMs: 50, due: () => "loading" } });
    mock.setNow(50);
    stage.frame();
    mock.setNow(100);
    stage.frame();

    // The swap: the next scene declares the same layers and opens an overlay at once, landed: it freezes the scene.
    mock.api.sync.leave.land();
    mock.world.projection.setLayers([...LAYERS]);

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);

    const seen: boolean[] = [];

    for (let now = 116; now <= 600; now += 16) {
      mock.setNow(now);
      stage.frame();
      if (loading.parent === mock.ctx.state.sync.leave.objects?.held) seen.push(loading.renderable);
    }

    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(false);
  });
});
