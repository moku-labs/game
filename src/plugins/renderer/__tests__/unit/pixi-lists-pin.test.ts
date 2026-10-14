import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A pin on Pixi 8's change lists, the private fields the dev missed-mark check
// of `demand/check.ts` reads (and nothing else in the engine does). When a
// Pixi upgrade renames or reshapes them, this fails, and the check is updated
// with the upgrade instead of switching itself off quietly.
// ---------------------------------------------------------------------------

/** What the check reads of a render group. */
type Lists = {
  childrenToUpdate: Record<number, { list: unknown[]; index: number }>;
  childrenRenderablesToUpdate: { list: unknown[]; index: number };
  renderGroupChildren: unknown[];
};

/**
 * The render group of a container, read the way the check reads it.
 *
 * @param container - A container with `isRenderGroup`.
 * @returns Its lists.
 */
function listsOf(container: pixi.Container): Lists {
  return Reflect.get(container, "renderGroup") as Lists;
}

describe("Pixi's render group lists", () => {
  it("lists a changed child of a render group in childrenToUpdate, by depth", () => {
    const stage = new pixi.Container({ isRenderGroup: true });
    const child = new pixi.Container();

    stage.addChild(child);
    child.x = 12;

    const depth = listsOf(stage).childrenToUpdate[1];

    expect(depth?.list.slice(0, depth.index)).toContain(child);
  });

  it("keeps the view changes in childrenRenderablesToUpdate, a list and its live length", () => {
    // A view is listed there once Pixi rendered it; a fresh one is flagged at construction.
    const stage = new pixi.Container({ isRenderGroup: true });
    const renderables = listsOf(stage).childrenRenderablesToUpdate;

    expect(Array.isArray(renderables.list)).toBe(true);
    expect(renderables.index).toBe(0);
  });

  it("keeps a nested render group in renderGroupChildren", () => {
    const stage = new pixi.Container({ isRenderGroup: true });
    const nested = new pixi.Container({ isRenderGroup: true });

    stage.addChild(nested);

    expect(listsOf(stage).renderGroupChildren).toContain(Reflect.get(nested, "renderGroup"));
  });
});
