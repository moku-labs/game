import { describe, expect, it } from "vitest";
import { Text } from "../../../text/components";
import type { Entity } from "../../../world/types";
import { NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { type StayedPerf, startStayedPerf } from "./reconcile-stayed.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-24-f230-hot-path, U2: `ui.reconcile` and `ui.solve` of the stayed root, 108 elements, handed the other
// of two prebuilt equal trees at every call. Measured on Node 24.21, warm:
//   before the change   188 023 B a render: per element the child identities (a list, two strings), the entry
//                       iterator of `leaveOut`, the next child list, the set of kept entities and the `every`
//                       callbacks of `diffChildren`, the flags of `isFlagsOf` and their argument, the `Change`
//                       record, the `expand` result, and the key lists and callbacks of `sameValue` on the styles
//   now                 0 B: scratch buffers by depth, identities kept on the elements, one change record, the
//                       flags kept while they hold, `sameValue` walking the keys with `for…in`
// ---------------------------------------------------------------------------

/** Calls of a window. */
const CALLS = 5000;

/**
 * The entity of the text that shows a content.
 *
 * @param perf - The started stayed perf app.
 * @param content - The content.
 * @returns The entity.
 */
function textShowing(perf: StayedPerf, content: string): Entity {
  const ecs = perf.ui.app.world.ecs;

  for (const [entity] of ecs.query(Text)) {
    if (ecs.get(entity, Text)?.content === content) return entity;
  }

  throw new Error(`perf: no text shows "${content}"`);
}

describe("ui reconcile of a root whose elements all stayed: heap per render", () => {
  it("reconciles and solves the root handed an equal tree with nothing allocated", async ({
    annotate
  }) => {
    const perf = await startStayedPerf();
    const title = textShowing(perf, "title 0");

    // The window's renders reach the root: the changed tree retitles it, the first gives it back.
    perf.changed();
    expect(perf.ui.app.world.ecs.get(title, Text)?.content).toBe("retitled 0");
    perf.changed();
    expect(perf.ui.app.world.ecs.get(title, Text)?.content).toBe("title 0");

    const bytes = bytesPerCall(perf.stayed, CALLS);

    await annotate(`reconcile + solve, 108 elements stayed: ${bytes} B a render`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);

    await perf.ui.app.stop();
  });
});
