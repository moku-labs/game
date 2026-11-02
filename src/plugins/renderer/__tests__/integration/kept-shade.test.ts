import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";
import { shadedSlot } from "../quad-harness";

// ---------------------------------------------------------------------------
// Integration: a view on its filter's own shader across a lost device, over the whole renderer and the real Pixi of
// `stagePixi`. Nothing of the mesh, its shader or its one geometry outlives the device.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();

  vi.restoreAllMocks();
});

/**
 * Lets the restore of a lost device finish.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

describe("a shaded view and a lost device", () => {
  // Bug: a mesh on the geometry of a device that went: a throw in the first frame after a restore, or a warm-up that
  // hangs on a program it cannot draw.
  it("a rebuild takes the views again, enters the mode on a new geometry, and the warm-up finishes", async () => {
    const drawn = await startDrawn({ onDemand: false, config: { warm: 8 } });

    running.push(drawn);

    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const slot = shadedSlot();
    const { kept, sync } = drawn.mock.ctx.state;

    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [slot]);

    const warmed = drawn.mock.api.sync.filters.warm(slot.filter, slot.quad);

    drawn.frames(12);
    await expect(warmed).resolves.toBe(true);

    /** One frame without the oracle, which watches the first application. */
    const frame = (): void => {
      drawn.mock.modules.sync.pass();
      drawn.mock.world.clearChanges();
      drawn.mock.runPhase("input");
      drawn.mock.runPhase("render");
    };

    /** One frame in which the card's number is written. */
    const write = (): void => {
      drawn.mock.api.invalidate(card);
      frame();
    };

    for (let turn = 0; turn < 3; turn += 1) write();

    const lost = kept.byEntity.get(card);
    const geometry = kept.quadGeometry;

    expect(lost?.shaded).toBe(true);
    expect(geometry).toBeDefined();

    const before = drawn.stage.last();

    before.renderer.loseDevice?.("unknown");
    await settle();

    expect(drawn.stage.last()).not.toBe(before);
    expect(kept.quadGeometry).toBeUndefined();
    expect(lost?.shade).toBeUndefined();

    for (let turn = 0; turn < 12; turn += 1) frame();

    const taken = kept.byEntity.get(card);

    expect(taken).not.toBe(lost);
    expect(taken?.mode).toBe("kept");
    expect(sync.warm.head).toBe(0);
    expect(sync.warm.queue).toHaveLength(0);
    expect(sync.warm.failed).toBe(false);

    for (let turn = 0; turn < 3; turn += 1) write();

    expect(taken?.shaded).toBe(true);
    expect(kept.quadGeometry).toBeDefined();
    expect(kept.quadGeometry).not.toBe(geometry);
    expect(taken?.shade?.mesh.geometry).toBe(kept.quadGeometry);
  });
});
