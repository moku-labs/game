import { describe, expect, it } from "vitest";
import { Sprite } from "../../components";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, startSprites, storedSprite } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: a sprite whose alpha a tween writes every frame (R2 of change 2026-10-18-cheap-idle-tick). Its stretch stays,
// so its look is written and nothing is laid out again: no new objects, and its filter area is not written again
// (the spy of that is in `unit/sync-sprite-stretch.test.ts`).
// ---------------------------------------------------------------------------

describe("a sprite's alpha tween", () => {
  it("allocates nothing a frame, the sprite carrying a filter area", async () => {
    const { mock, entities } = await startSprites(20);
    const entity = entities[10] ?? 0;

    mock.api.sync.filters.area(entity, [0, 0, 64, 64]);
    mock.modules.sync.pass();
    // The change mark of the frame, made once: the window writes the stored alpha in place, as a tween's value.
    mock.world.ecs.set(entity, Sprite, { alpha: 0.5 });

    const sprite = storedSprite(mock, entity);

    expect(
      bytesPerCall(() => {
        sprite.alpha = sprite.alpha === 0.5 ? 0.6 : 0.5;
        mock.modules.sync.pass();
      })
    ).toBeLessThanOrEqual(BUDGET.spriteAlphaTween + NOISE);
  });
});
