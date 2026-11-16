import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { releaseBindGroups } from "../../sources";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { deadCases, liveCase, rebind } from "./sources-fixtures";

// ---------------------------------------------------------------------------
// Perf: the release of a destroyed source from Pixi's cached batch bind groups (F194), which every destroy of a
// loaded file or a kept picture runs, hundreds per closed window.
// ---------------------------------------------------------------------------

const EMPTY = pixi.Texture.EMPTY.source;

/** The calls of the dead case's window: each one spends a source, and `alloc` makes up to 5 000 + 18 windows. */
const DEAD_CALLS = 200;

describe("the release of a source from its bind groups", () => {
  // Bug: the swap copies the group's slots or its key list into a new array.
  it("allocates nothing for a group that still binds a live texture", () => {
    const live = liveCase();

    expect(
      bytesPerCall(() => {
        releaseBindGroups(live.gone, EMPTY);
        rebind(live);
      })
    ).toBeLessThanOrEqual(BUDGET.releaseBindLive + NOISE);
  });

  // Bug: the dead group's listeners leave EMPTY through eventemitter3's `off`, which copies the whole list per call.
  it("allocates nothing for a group whose last texture goes", () => {
    const sources = deadCases(5000 + 9 * DEAD_CALLS);
    let next = 0;

    expect(
      alloc(() => {
        releaseBindGroups(sources[next++] as pixi.TextureSource, EMPTY);
      }, DEAD_CALLS)
    ).toBeLessThanOrEqual(BUDGET.releaseBindDead + NOISE);
  });
});
