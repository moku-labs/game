import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import type { HudReturn, OverlayValue } from "../../components";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: `sync.debug.hudReturns()` (F240 follow-up). One report per run in `OverlayState.returns`, in order, read
// also after the overlay's record is gone, with the fade 0 under reduced motion, a fresh array each call, and an
// answer only in a dev or agent build with a root.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/** The splash of the design: back 1100 ms after the leave started, over 700 ms. */
const SPLASH: HudReturn = { delayMs: 1100, fadeMs: 700 };

/**
 * Starts a stage the overlay tests run on, with a frame delta of 50 ms so the elapsed times are round.
 *
 * @param options - The stage's options: a dev or agent build answers, any other does not.
 * @returns The stage.
 */
async function reportStage(
  options?: Parameters<typeof startOverlayStage>[0]
): Promise<OverlayStage> {
  const stage = await startOverlayStage(options ?? { agent: true });

  running.push(stage);
  stage.drawn.mock.setFrameDelta(50);

  return stage;
}

/**
 * Opens an overlay and lands it.
 *
 * @param stage - The stage.
 * @param value - Its marker.
 * @param order - Its order in the ui layer.
 * @returns The overlay.
 */
function shown(stage: OverlayStage, value: Partial<OverlayValue>, order = 2): Entity {
  const overlay = stage.overlay(value, { order });

  stage.level(overlay, 1, true);
  stage.frames(2);

  return overlay;
}

/**
 * Starts an overlay's leave (the run's 0 frame) and removes it, so its run counts alone from then on.
 *
 * @param stage - The stage.
 * @param overlay - The overlay.
 */
function leaveAndGo(stage: OverlayStage, overlay: Entity): void {
  stage.leave(overlay);
  stage.frame();
  stage.drawn.mock.world.ecs.despawn(overlay);
}

/**
 * The label the overlay's record holds, which a run takes at its start.
 *
 * @param stage - The stage.
 * @param overlay - The overlay.
 * @returns The label.
 */
function labelOf(stage: OverlayStage, overlay: Entity): string | undefined {
  return stage.drawn.mock.ctx.state.sync.overlay.records.get(overlay)?.label;
}

describe("debug.hudReturns()", () => {
  // Bug: the reports are in another order than the runs, or two runs share one owner's numbers.
  it("reports every run in the order they started, each with its own owner, label, times and elapsed", async () => {
    const stage = await reportStage();
    const { debug } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH }, 2);
    const sheet = shown(stage, { hud: "none", hudReturn: { delayMs: 200, fadeMs: 100 } }, 3);
    const splashLabel = labelOf(stage, splash);
    const sheetLabel = labelOf(stage, sheet);

    stage.leave(splash);
    stage.frames(3);
    stage.leave(sheet);
    stage.frame();

    expect(splashLabel).not.toBe(sheetLabel);
    expect(debug.hudReturns()).toEqual([
      { owner: splash, label: splashLabel, delayMs: 1100, fadeMs: 700, elapsed: 150 },
      { owner: sheet, label: sheetLabel, delayMs: 200, fadeMs: 100, elapsed: 0 }
    ]);
  });

  // Bug: the reader walks the overlay records, so a run whose overlay is gone is lost; or the run is reported while the
  // overlay line is also there.
  it("still reports a run after its overlay is gone, where debug.overlays() has no line for it", async () => {
    const stage = await reportStage();
    const { debug } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });
    const label = labelOf(stage, splash);

    stage.leave(splash);
    stage.frame();
    expect(debug.overlays().map(line => line.hudReturn?.elapsed)).toEqual([0]);

    stage.drawn.mock.world.ecs.despawn(splash);
    stage.frames(29);

    expect(debug.overlays()).toEqual([]);
    expect(debug.hudReturns()).toEqual([
      { owner: splash, label, delayMs: 1100, fadeMs: 700, elapsed: 1450 }
    ]);
  });

  // Bug: a run that ended stays in the report (the pool is read, or the end is not cut).
  it("reports nothing once the run has ended", async () => {
    const stage = await reportStage();
    const { debug } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 100, fadeMs: 100 } });

    leaveAndGo(stage, splash);
    stage.frames(3);
    expect(debug.hudReturns().map(report => report.elapsed)).toEqual([150]);

    stage.frame();
    expect(stage.drawn.mock.ctx.state.sync.overlay.returnPool).toHaveLength(1);
    expect(debug.hudReturns()).toEqual([]);
  });

  // Bug: reduced motion is not read, so the report shows the fade the HUD no longer takes; or it cuts the delay too.
  it("reports a fade of 0 for a run started under reduced motion, its delay kept", async () => {
    const stage = await reportStage();
    const { debug, leave } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    leave.setReducedMotion(true);
    leaveAndGo(stage, splash);

    expect(debug.hudReturns().map(report => [report.delayMs, report.fadeMs])).toEqual([[1100, 0]]);
  });

  // Bug: the reader hands out the run itself or a shared array: a write by a tool changes the HUD's own clock.
  it("answers a fresh array of fresh reports at every call: a write to one changes no run", async () => {
    const stage = await reportStage();
    const { debug } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    leaveAndGo(stage, splash);
    stage.frame();

    const first = debug.hudReturns();
    const second = debug.hudReturns();

    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);

    const report = first[0];

    if (report === undefined) throw new Error("no report");

    report.elapsed = 99_999;
    report.delayMs = 0;
    expect(debug.hudReturns()[0]).toMatchObject({ delayMs: 1100, elapsed: 50 });
    expect(stage.drawn.mock.ctx.state.sync.overlay.returns[0]?.elapsed).toBe(50);
  });

  // Bug: an overlay with no `hudReturn`, or none at all, gets a report.
  it("answers [] with no overlay, and with overlays that have no hudReturn", async () => {
    const stage = await reportStage();
    const { debug } = stage.drawn.mock.api.sync;

    expect(debug.hudReturns()).toEqual([]);

    const shop = shown(stage, { hud: "none" });

    stage.leave(shop);
    stage.frames(2);
    expect(debug.hudReturns()).toEqual([]);
  });

  // Bug: the dev guard is missing or negated: a release build pays for the report and answers it.
  it("answers a frozen [] in a release build while a run is in progress", async () => {
    const stage = await reportStage({});
    const { debug } = stage.drawn.mock.api.sync;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    vi.stubGlobal("__MOKU_GAME_AGENT__", false);
    leaveAndGo(stage, splash);
    stage.frame();

    expect(stage.drawn.mock.ctx.state.sync.overlay.returns).toHaveLength(1);
    expect(debug.hudReturns()).toEqual([]);
    expect(Object.isFrozen(debug.hudReturns())).toBe(true);
  });

  // Bug: the root is not checked: a lost device reports runs of a tree that is gone.
  it("answers [] while the renderer has no tree, with a run still held", async () => {
    const stage = await reportStage({ dev: true });
    const { mock } = stage.drawn;
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    leaveAndGo(stage, splash);
    expect(mock.api.sync.debug.hudReturns()).toHaveLength(1);

    mock.modules.sync.forget();
    expect(mock.ctx.state.sync.overlay.returns).toHaveLength(1);
    expect(mock.api.sync.debug.hudReturns()).toEqual([]);
  });
});
