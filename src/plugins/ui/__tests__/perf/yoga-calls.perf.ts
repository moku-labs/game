import { beforeAll, describe, expect, it } from "vitest";
import type { Node as YogaNode } from "yoga-layout/load";
import { alloc } from "../../../../../tests/perf/alloc";
import { loadYogaModule } from "../../layout/yoga";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1, step 7: the Yoga calls a turn of the album makes (`album.perf.ts`), each
// alone, heap bytes per call, through the module `ui` loads. Counted on the album turn (Node 24.21): 4 `setWidth`,
// 2 `setPosition`, 2 `removeChild`, 2 `insertChild`, 1 `calculateLayout`, and the reads of the solve. yoga-layout's
// `wrapAssembly` replaces `setWidth`, `setPosition` and their kin with a wrapper that copies its arguments into two
// arrays and calls the method it wraps through two spreads; that method is kept in the wrapper's closure, so no call
// of the engine reaches it. `setWidthPercent` and `setPositionPercent` are embind's methods as they come, unwrapped:
// a wrapped setter is measured against its unwrapped sibling, so the wrapper's own bytes show. Measured alone, on
// Node 24.21, warm:
//   setWidth 480 B, setWidthPercent 88 B; setPosition 736 B, setPositionPercent 288 B (the wrapper: ~390 and ~450 B);
//   2 removeChild + 2 insertChild 769 B; one embind read alone 64 B.
// Inside the album's solve the reads are inlined and keep nothing (the heap profile of the turn attributes them none).
// What a turn keeps in yoga-layout's own frames, by the heap profile: ~2.8 KB, `YOGA_BYTES` of `album.perf.ts`.
// ---------------------------------------------------------------------------

/** Calls of a window: one Yoga call is well under a microsecond. */
const CALLS = 20_000;

/** Two lengths a setter alternates between, read from a typed array so the caller boxes none. */
const LENGTHS = new Float64Array([120, 121]);

/** What a wrapped setter may keep per call: the measured 480 B and 736 B, and a margin. */
const WRAPPED_SETTER_BYTES = 800;

/** What a move of one child out and back in, twice, may keep: the measured 769 B, and a margin. */
const MOVE_BYTES = 850;

/** The module and the nodes of the calls: a root with two children. */
let yoga: Awaited<ReturnType<typeof loadYogaModule>>;
let root: YogaNode;
let first: YogaNode;

beforeAll(async () => {
  yoga = await loadYogaModule();
  root = yoga.Node.create();
  first = yoga.Node.create();
  root.insertChild(first, 0);
  root.insertChild(yoga.Node.create(), 1);
  root.calculateLayout(390, 844, yoga.DIRECTION_LTR);
});

/**
 * Bytes per call of a step that alternates between two states, so no call is skipped as a no-op.
 *
 * @param step - The call, handed 0 or 1.
 * @returns Bytes per call.
 */
function perCall(step: (at: number) => void): number {
  const at = new Int32Array(1);

  return alloc(() => {
    at[0] = at[0] === 0 ? 1 : 0;
    step(at[0]);
  }, CALLS);
}

describe("ui: the Yoga calls of an album turn, heap bytes per call", () => {
  it("keeps more in a setter yoga-layout wraps than in its unwrapped sibling", async ({
    annotate
  }) => {
    // Bug caught: the remainder of the album turn charged to Yoga while it is the engine's, or a wrapped setter whose
    // bytes grew: a wrapped setter keeps its argument copies on top of what embind's own method keeps.
    const setWidth = perCall(at => root.setWidth(LENGTHS[at] ?? 0));
    const setWidthPercent = perCall(at => root.setWidthPercent(LENGTHS[at] ?? 0));
    const setPosition = perCall(at => first.setPosition(yoga.EDGE_LEFT, LENGTHS[at] ?? 0));
    const setPositionPercent = perCall(at =>
      first.setPositionPercent(yoga.EDGE_LEFT, LENGTHS[at] ?? 0)
    );

    await annotate(
      `setWidth ${setWidth} B, setWidthPercent ${setWidthPercent} B, setPosition ${setPosition} B, ` +
        `setPositionPercent ${setPositionPercent} B`
    );
    expect(setWidth).toBeGreaterThan(setWidthPercent);
    expect(setPosition).toBeGreaterThan(setPositionPercent);
    expect(setWidth).toBeLessThanOrEqual(WRAPPED_SETTER_BYTES);
    expect(setPosition).toBeLessThanOrEqual(WRAPPED_SETTER_BYTES);
  });

  it("keeps a bounded count in a move of one child out of its parent and back in", async ({
    annotate
  }) => {
    // Bug caught: a reorder of two children that keeps more per call than embind's own methods keep.
    /* eslint-disable unicorn/prefer-dom-node-remove -- a Yoga node, not a DOM node: Yoga has no `remove`. */
    const move = perCall(() => {
      root.removeChild(first);
      root.insertChild(first, 1);
      root.removeChild(first);
      root.insertChild(first, 0);
    });
    /* eslint-enable unicorn/prefer-dom-node-remove */

    await annotate(`2 removeChild + 2 insertChild: ${move} B`);
    expect(move).toBeLessThanOrEqual(MOVE_BYTES);
  });
});
