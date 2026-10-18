import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../components";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, startSprites, storedTransform } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: one pass of the renderer's sync system over 300 sprite views (R4 of change 2026-10-18-cheap-idle-tick). A
// still pass changes nothing and must cost nothing; one moved view costs its own writes and nothing per pass.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A pass that moves one view of 300 every call: its change mark made once, the stored value moved in place.
 *
 * @returns The step.
 */
async function moveStep(): Promise<() => void> {
  const { mock, entities } = await startSprites(300);
  const entity = entities[150] ?? 0;

  mock.world.ecs.set(entity, Transform, { x: 1 });

  const moved = storedTransform(mock, entity);

  return () => {
    moved.x = moved.x === 1 ? 2 : 1;
    mock.modules.sync.pass();
  };
}

describe("the sync pass", () => {
  it("allocates nothing on a still pass over 300 views", async () => {
    const { mock } = await startSprites(300);

    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.syncPassStill + NOISE
    );
  });

  it("allocates nothing on a still pass of an agent build, whose tree check reads what changed", async () => {
    const { mock } = await startSprites(300);

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.syncPassStillAgent + NOISE
    );
  });

  it("allocates nothing on a pass that moves one view of 300", async () => {
    expect(bytesPerCall(await moveStep())).toBeLessThanOrEqual(BUDGET.syncPassMove + NOISE);
  });

  it("allocates nothing on a pass of an agent build that moves one view: the tree check reads no move", async () => {
    const step = await moveStep();

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    expect(bytesPerCall(step)).toBeLessThanOrEqual(BUDGET.syncPassMoveAgent + NOISE);
  });
});
