import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { FADE_DY, markedIn, startWarm, untilWarm, type Warm, type WarmOptions } from "../warm-app";

// ---------------------------------------------------------------------------
// Unit: the first frame of a window held warm (F241). A held view whose root comes in with an
// additive walk is drawn, in the frame it is first shown, at the walk's first sample, as a window
// opened cold is: never one frame at rest before its enter starts. The oracle is the same window
// opened in a headless app, where nothing is warm.
// ---------------------------------------------------------------------------

const started: Warm[] = [];

afterEach(async () => {
  for (const warm of started.splice(0)) await warm.app.stop();

  vi.restoreAllMocks();
});

/**
 * Starts a fixture and stops it after the test.
 *
 * @param options - The clock step and whether the renderer draws.
 * @returns The started fixture.
 */
async function start(options: WarmOptions = {}): Promise<Warm> {
  const warm = await startWarm(options);

  started.push(warm);

  return warm;
}

/**
 * Records, at the end of phase `sync` of every frame, how far the fading root stands off its rest
 * `y`, once it is live: what `renderer.sync`, the last system of the phase, handed to Pixi. A value
 * written later in the frame is not drawn in it.
 *
 * @param warm - The started fixture.
 * @returns The offsets, one per frame the root was live and shown.
 */
function drawnOffsets(warm: Warm): number[] {
  const offsets: number[] = [];

  warm.app.time.onFrame("sync", () => {
    const root = markedIn(warm, "fadeRoot");

    if (root === undefined || warm.app.world.projection.isBuilding(root)) return;

    const now = warm.app.world.ecs.get(root, Transform);
    const rest = warm.app.world.projection.restOf(root, Transform);

    if (now !== undefined && rest !== undefined) offsets.push(Math.round(now.y - rest.y));
  });

  return offsets;
}

/**
 * Opens the fading sheet and steps three frames.
 *
 * @param warm - The started fixture, the sheet mounted.
 * @returns The offsets the root was drawn at.
 */
async function openFade(warm: Warm): Promise<number[]> {
  const offsets = drawnOffsets(warm);

  await warm.answer("openFade");

  for (let index = 0; index < 3; index += 1) warm.frame();

  return offsets;
}

describe("the first frame of a window held warm (F241)", () => {
  // Bug: the held view is drawn at rest in the frame it is first shown, and its enter's first
  // sample lands a frame later: the player sees the whole window, then it jumps to the start of its
  // fade (a double blink).
  it("draws the root at its enter's first sample in the frame it opens, as a cold open does", async () => {
    const cold = await start({ drawing: false });

    cold.mount(["warm.fade"]);
    cold.frame();

    const coldOffsets = await openFade(cold);

    const warm = await start();

    warm.mount(["warm.fade"]);
    untilWarm(warm, 1);

    const warmOffsets = await openFade(warm);

    expect(coldOffsets[0]).toBe(FADE_DY);
    expect(warmOffsets[0]).toBe(FADE_DY);
    expect(warmOffsets).toEqual(coldOffsets);
  });
});
