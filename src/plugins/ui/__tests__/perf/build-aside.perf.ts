import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import {
  bytesPerCall,
  startAsidePerf,
  startPartsCommittedPerf,
  startPartsPerf,
  startPerfUi
} from "./fixtures";

describe("ui and a scene built aside: heap per frame", () => {
  it("asks ui's part of a build over ten roots at rest and no root built aside within budget", async ({
    annotate
  }) => {
    const ui = await startPerfUi();
    const bytes = bytesPerCall(() => {
      ui.built();
    });

    await annotate(`ui's part of a build, 10 roots, none aside: ${bytes} B a call`);
    expect(ui.built()).toBe(true);
    expect(bytes).toBeLessThanOrEqual(BUDGET.asideBuiltIdle + NOISE_BYTES);

    await ui.app.stop();
  });

  it("asks ui's part of a build while a root is built aside within budget", async ({
    annotate
  }) => {
    const ui = await startAsidePerf();
    const bytes = bytesPerCall(() => {
      ui.built();
    });

    await annotate(`ui's part of a build, 11 roots, one aside and solved: ${bytes} B a call`);
    expect(ui.built()).toBe(true);
    expect(bytes).toBeLessThanOrEqual(BUDGET.asideBuiltBuilding + NOISE_BYTES);

    await ui.app.stop();
  });

  it("holds the enters of a root built aside in ui.enter within budget", async ({ annotate }) => {
    const ui = await startAsidePerf();
    const bytes = bytesPerCall(ui.enter);

    await annotate(`ui.enter, the names' elements held: ${bytes} B a frame`);
    // The names are built aside: `find` does not answer them yet.
    expect(ui.app.ui.find("boxName0")).toBeUndefined();
    expect(bytes).toBeLessThanOrEqual(BUDGET.enterHeld + NOISE_BYTES);

    await ui.app.stop();
  });

  it("runs the reconcile and the solve of a frame while a root is built aside within budget", async ({
    annotate
  }) => {
    const ui = await startAsidePerf();
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, 11 roots, one aside: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileBuilding + NOISE_BYTES);

    await ui.app.stop();
  });
});

describe("ui and a scene built in parts: heap per frame", () => {
  it("drains an empty queue in the reconcile and the solve of a frame within budget", async ({
    annotate
  }) => {
    const ui = await startPartsPerf();
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(
      `reconcile + solve, one root built in parts, its queue empty: ${bytes} B a frame`
    );
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileParked + NOISE_BYTES);

    await ui.app.stop();
  });

  it("asks ui's part of a build whose parts are all made within budget", async ({ annotate }) => {
    const ui = await startPartsPerf();
    const bytes = bytesPerCall(() => {
      ui.built();
    });

    await annotate(`ui's part of a build, one root built in parts and applied: ${bytes} B a call`);
    expect(ui.built()).toBe(true);
    expect(bytes).toBeLessThanOrEqual(BUDGET.asideBuiltParked + NOISE_BYTES);

    await ui.app.stop();
  });

  it("runs an idle frame after a build in parts was committed within budget", async ({
    annotate
  }) => {
    const ui = await startPartsCommittedPerf();
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, no build, a root once built in parts: ${bytes} B a frame`);
    expect(ui.app.ui.find("boxName0")).toBeDefined();
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileAfterParts + NOISE_BYTES);

    await ui.app.stop();
  });
});
