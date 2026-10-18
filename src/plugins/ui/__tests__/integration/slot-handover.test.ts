import { afterEach, describe, expect, it, vi } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { mountScreens, type SlotApp, startSlotApp } from "../slot-app";

// ---------------------------------------------------------------------------
// Integration: the slots are assigned again only when a host or a root moved
// (change 2026-10-18-cheap-idle-tick, U2). A slot whose exit ends is such a
// move: the root it kept goes to the other slot that names it in that frame,
// and is never taken for a cycle of slots.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The entity of a keyed element of the running app.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity, -1 when the key is not mounted.
 */
function entityOf(app: SlotApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return app.ui.find(key) ?? -1;
}

describe("a root whose slot exits while a second slot names it", () => {
  it("moves to the second slot in the frame the first one is gone", async () => {
    const { app } = await startSlotApp();

    mountScreens(app, ["slot.host", "slot.row"]);

    const root = entityOf(app, "slotRowRoot");
    const slot = entityOf(app, "rowSlot");
    const twin = entityOf(app, "twinSlot");

    // The twin names the row too; the row stays in the slot it has.
    app.input.tap(entityOf(app, "twin"));
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(root, Parent)).toEqual({ entity: slot });

    // The slot leaves with its exit motion and keeps the row until it is gone.
    app.input.tap(entityOf(app, "remove"));
    app.time.step(16);

    let frames = 0;

    while (app.world.ecs.get(slot, Transform) !== undefined && frames < 40) {
      app.time.step(16);
      frames += 1;
    }

    expect(app.world.ecs.get(slot, Transform)).toBeUndefined();
    expect(app.world.ecs.get(root, Parent)).toEqual({ entity: twin });
    expect(app.log.trace().filter(entry => entry.event === "ui:slot-cycle")).toEqual([]);

    await app.stop();
  });
});
