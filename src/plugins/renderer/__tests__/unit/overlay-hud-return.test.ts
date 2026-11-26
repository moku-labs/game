import { afterEach, describe, expect, it, vi } from "vitest";
import { Exiting, Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import {
  HudPart,
  type HudReturn,
  type HudReturnKey,
  Overlay,
  type OverlayValue,
  Transform
} from "../../components";
import { clampedReturn, returnFactor, sameReturn, samplePose } from "../../sync/overlay-return";
import type { ClampedHudReturn } from "../../sync/types";
import { endStage, OVERLAY_LAYERS, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the return of the HUD parts an overlay hid (F240, `Overlay.hudReturn`). A run starts in the overlay's
// first exit frame, counts the game time the render phase receives, outlives the record, multiplies the factor of the
// parts it holds, and ends at the last delay plus fade, when the overlay shows again, or on new layers. The atomicity
// checker of every frame multiplies the levels' factor by the returns, computed from the runs' own numbers.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/** The splash of the design: back 1100 ms after the leave started, over 700 ms. */
const SPLASH: HudReturn = { delayMs: 1100, fadeMs: 700 };

/**
 * Starts a stage with three parts in the HUD layer: energy at (100, 100), gems at (400, 100), stars at (700, 100).
 *
 * @param options - The stage's options.
 * @returns The stage and the three parts.
 */
async function returnStage(options: Parameters<typeof startOverlayStage>[0] = {}) {
  const stage = await startOverlayStage(options);

  running.push(stage);

  const energy = stage.view({ layer: "hud", x: 100, y: 100, extra: [HudPart({ key: "energy" })] });
  const gems = stage.view({ layer: "hud", x: 400, y: 100, extra: [HudPart({ key: "gems" })] });
  const stars = stage.view({ layer: "hud", x: 700, y: 100, extra: [HudPart({ key: "stars" })] });

  stage.frames(2);

  return { stage, energy, gems, stars };
}

/**
 * The factor a part is drawn with now.
 *
 * @param stage - The stage.
 * @param entity - The part.
 * @returns Its factor.
 */
function factor(stage: OverlayStage, entity: Entity): number {
  return stage.drawn.mock.ctx.state.sync.views.get(entity)?.hud ?? Number.NaN;
}

/**
 * The overlay state of the stage.
 *
 * @param stage - The stage.
 * @returns The state.
 */
function overlayOf(stage: OverlayStage) {
  return stage.drawn.mock.ctx.state.sync.overlay;
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
 * Starts an overlay's leave (its first exit frame, the run's 0) and removes it, so its run counts alone from then on.
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
 * One frame of a given game time.
 *
 * @param stage - The stage.
 * @param deltaMs - Its delta, before the time scale.
 * @returns True when it was drawn.
 */
function step(stage: OverlayStage, deltaMs: number): boolean {
  stage.drawn.mock.setFrameDelta(deltaMs);

  return stage.frame();
}

/**
 * Stops a stage a test registered, for a test whose point is the stop: taken off the list first, so `afterEach` does
 * not stop it again, and stopped there instead when an assertion before this throws.
 *
 * @param stage - The stage.
 */
function stopNow(stage: OverlayStage): void {
  running.splice(running.indexOf(stage), 1);
  stage.drawn.mock.stop();
}

describe("the run of a HUD return", () => {
  // Bug: a leave with no `hudReturn` starts a run (a default return): the parts wait after every overlay.
  it("starts none without hudReturn: the parts come back with the overlay's own leave, as before", async () => {
    const { stage, energy } = await returnStage();
    const shop = shown(stage, { hud: "none" });

    stage.leave(shop);
    stage.level(shop, 0.5);
    stage.frame();
    expect(factor(stage, energy)).toBe(0.5);

    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frame();
    expect(factor(stage, energy)).toBe(1);
    expect(overlayOf(stage).returns).toHaveLength(0);
  });

  // Bug: the run starts when the record goes (an 800 ms leave added to the delay), or for a `hud` that hid nothing (a
  // run in the exit frame or in the frame after it).
  it.each<[OverlayValue["hud"], number[], number[]]>([
    ["none", [0], [16]],
    [["energy"], [0], [16]],
    ["all", [], []],
    ["under", [], []]
  ])("with hud %j the runs count %j in the first exit frame and %j in the next", async (hud, first, next) => {
    const { stage } = await returnStage();
    const splash = shown(stage, { dim: 0.5, hud, hudReturn: SPLASH });
    const elapsed = (): number[] => overlayOf(stage).returns.map(run => run.elapsed);

    stage.leave(splash);
    stage.frame();
    expect(elapsed()).toEqual(first);

    stage.frame();
    expect(elapsed()).toEqual(next);
  });

  // Bug: only a turn starts a run, so an overlay whose record is made in its exit frame never holds its parts.
  it("starts a run for an overlay first seen already leaving", async () => {
    const { stage, energy } = await returnStage();
    const splash = stage.overlay({ hud: "none", hudReturn: SPLASH }, { order: 2 });

    stage.level(splash, 1);
    stage.leave(splash);
    stage.frame();
    stage.drawn.mock.world.ecs.despawn(splash);
    stage.frame();

    expect(overlayOf(stage).returns).toHaveLength(1);
    expect(factor(stage, energy)).toBe(0);
  });

  // Bug: a record dropped without a leave starts a run from its drop: there was no leave to count from.
  it("starts none for an overlay removed with no exit frame", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    stage.drawn.mock.world.ecs.despawn(splash);
    stage.frame();

    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(factor(stage, energy)).toBe(1);
  });
});

describe("the return factor", () => {
  // Bug: the boundaries moved by one (`<=` for `<`), the fade not linear, or a fade of 0 divided by.
  it("is 0 before the delay and at it, linear over the fade, and 1 at its end", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 160, fadeMs: 320 } });

    leaveAndGo(stage, splash);

    step(stage, 159);
    expect(factor(stage, energy)).toBe(0);
    step(stage, 1);
    expect(factor(stage, energy)).toBe(0);
    step(stage, 160);
    expect(factor(stage, energy)).toBe(0.5);
    step(stage, 160);
    expect(factor(stage, energy)).toBe(1);
  });

  // Bug: a fade of 0 divides by zero (NaN) or waits a frame past the delay. The stars come later, so the run is still
  // in progress at 160 ms and the energy's own factor is what is drawn.
  it("jumps to 1 at the delay with a fade of 0", async () => {
    const { stage, energy } = await returnStage();
    const late = { delayMs: 160, fadeMs: 0, parts: { stars: { delayMs: 1000 } } };
    const splash = shown(stage, { hud: "none", hudReturn: late });

    leaveAndGo(stage, splash);

    step(stage, 159);
    expect(factor(stage, energy)).toBe(0);
    step(stage, 1);
    expect(factor(stage, energy)).toBe(1);
    expect(overlayOf(stage).returns).toHaveLength(1);
  });

  // Bug: the run counts the page clock or a fixed 16 ms frame: a time scale does not slow it and a pause runs it on.
  it("counts game time: half the speed at scale 0.5, held at scale 0 whatever the page and world clocks say", async () => {
    const { stage, energy } = await returnStage();
    const { mock } = stage.drawn;
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 0, fadeMs: 320 } });

    // `time.setScale(0.5)`: the frames of 16 ms hand the phases 8 ms of game time.
    mock.setTimeScale(0.5);
    leaveAndGo(stage, splash);
    stage.frames(20);
    expect(factor(stage, energy)).toBe(0.5);

    // A game held at scale 0 while the page, the world and the snapshot clocks move on.
    mock.setTimeScale(0);
    mock.setNow(60_000);
    mock.setWorldNow(60_000);
    mock.setElapsed(60_000);
    stage.frames(30);
    expect(factor(stage, energy)).toBe(0.5);

    mock.setTimeScale(0.5);
    stage.frames(20);
    expect(factor(stage, energy)).toBe(1);
  });

  // Bug: the return replaces the overlay's factor instead of multiplying it, so the parts show while the splash leaves.
  it("multiplies the overlay's own leave: 0 at 400 and 800 ms, 0.5 at 1450 ms, 1 at 1800 ms for 1100 / 700", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { cover: "opaque", hud: "none", hudReturn: SPLASH });

    stage.drawn.mock.setFrameDelta(50);
    stage.leave(splash);
    stage.frame();

    for (let frame = 1; frame <= 16; frame += 1) {
      stage.level(splash, 1 - frame / 16);
      stage.frame();
      if (frame === 8) expect(factor(stage, energy)).toBe(0);
    }

    expect(factor(stage, energy)).toBe(0);
    stage.drawn.mock.world.ecs.despawn(splash);
    stage.frames(13);
    expect(factor(stage, energy)).toBe(0.5);
    stage.frames(7);
    expect(factor(stage, energy)).toBe(1);
    expect(overlayOf(stage).returns).toHaveLength(0);
  });

  // Bug: a new overlay ends or pauses the run, or the run's factor is lost once that overlay is gone.
  it("keeps counting under an overlay opened during the return, and draws its factor once that one is gone", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frames(4);

    const sheet = stage.overlay({ hud: "none" }, { order: 3 });

    stage.level(sheet, 1, true);
    stage.frames(4);
    expect(factor(stage, energy)).toBe(0);

    stage.leave(sheet);
    stage.level(sheet, 0);
    stage.frame();
    stage.drawn.mock.world.ecs.despawn(sheet);
    stage.frame();
    expect(factor(stage, energy)).toBe(0);
    expect(overlayOf(stage).returns[0]?.elapsed).toBe(500);

    stage.frames(19);
    expect(factor(stage, energy)).toBe(0.5);
  });
});

describe("the end of a run", () => {
  // Bug: the end is taken over the overlay's own times alone (a later part cut short), or over every key of `parts`,
  // a key the overlay keeps too (a run left counting for nothing).
  it("ends when the last part it holds is back: a later part extends it, a kept key does not", async () => {
    const { stage, stars } = await returnStage();
    const late = { delayMs: 100, fadeMs: 100, parts: { stars: { delayMs: 300 } } };
    const splash = shown(stage, { hud: "none", hudReturn: late });

    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frames(7);
    expect(overlayOf(stage).returns).toHaveLength(1);
    expect(factor(stage, stars)).toBe(0.5);
    stage.frame();
    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(overlayOf(stage).returnPool).toHaveLength(1);

    const sheet = shown(stage, { hud: ["stars"], hudReturn: late });

    leaveAndGo(stage, sheet);
    stage.frames(3);
    expect(overlayOf(stage).returns).toHaveLength(1);
    stage.frame();
    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(overlayOf(stage).returnPool).toHaveLength(1);
  });

  // Bug: a part held by a run, with no overlay in the order, still takes a tap.
  it("gives a part held at 0 no tap while no overlay is open, and a tap once the run is over", async () => {
    const { stage, energy } = await returnStage();
    const sync = stage.drawn.mock.api.sync;
    const tap = (): Entity | undefined => sync.hitTest(150, 150, entity => entity === energy);
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 200, fadeMs: 0 } });

    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frame();
    expect(overlayOf(stage).order).toHaveLength(0);
    expect(tap()).toBeUndefined();

    stage.frames(3);
    expect(tap()).toBe(energy);
  });

  // Bug: the leave is cancelled but its run goes on: the parts of the overlay shown again come back under it.
  it("ends at once when its overlay shows again", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 0, fadeMs: 1000 } });

    stage.leave(splash);
    stage.level(splash, 0.5);
    stage.frame();
    expect(overlayOf(stage).returns).toHaveLength(1);

    stage.drawn.mock.world.ecs.untag(splash, Exiting);
    stage.level(splash, 0.5);
    stage.frame();
    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(factor(stage, energy)).toBe(0.5);
  });

  // Bug: new layers keep the run of the old scene, so the HUD of the new one waits for it.
  it("ends every run on new layers", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    leaveAndGo(stage, splash);
    stage.frame();
    expect(factor(stage, energy)).toBe(0);

    stage.drawn.mock.world.projection.setLayers([...OVERLAY_LAYERS]);
    stage.frame();
    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(overlayOf(stage).returnPool).toHaveLength(1);
    expect(factor(stage, energy)).toBe(1);
  });

  // Bug: reduced motion cuts the delay too, or keeps the fade; or the run lasts the fade past the delay.
  it("keeps the delay and cuts the fade under reduced motion", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 160, fadeMs: 320 } });

    stage.drawn.mock.api.sync.leave.setReducedMotion(true);
    leaveAndGo(stage, splash);
    step(stage, 159);
    expect(factor(stage, energy)).toBe(0);
    step(stage, 1);
    expect(factor(stage, energy)).toBe(1);
    expect(overlayOf(stage).returns).toHaveLength(0);
  });
});

describe("parts and runs together", () => {
  // Bug: a key's own delay applied to every part, a key the run does not hold held anyway, or a listed part's fade lost.
  it("takes a key's own delay for that part alone, and ignores a key of parts the overlay keeps", async () => {
    const { stage, energy, gems, stars } = await returnStage();
    const staggered = {
      delayMs: 100,
      fadeMs: 100,
      parts: { gems: { delayMs: 300 }, stars: { delayMs: 500 } }
    };
    const splash = shown(stage, { hud: ["stars"], hudReturn: staggered });

    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frame();
    expect([factor(stage, energy), factor(stage, gems), factor(stage, stars)]).toEqual([0, 0, 1]);

    stage.frames(3);
    expect([factor(stage, energy), factor(stage, gems), factor(stage, stars)]).toEqual([1, 0, 1]);

    stage.frames(3);
    expect(factor(stage, gems)).toBe(0.5);
  });

  // Bug: the last run wins instead of the product of every run in progress.
  it("draws a part two runs hold with the product of both", async () => {
    const { stage, energy, stars } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 0, fadeMs: 400 } }, 2);
    const sheet = shown(stage, { hud: ["stars"], hudReturn: { delayMs: 0, fadeMs: 200 } }, 3);

    stage.drawn.mock.setFrameDelta(50);
    stage.leave(splash);
    stage.leave(sheet);
    stage.frame();
    stage.drawn.mock.world.ecs.despawn(splash);
    stage.drawn.mock.world.ecs.despawn(sheet);
    stage.frames(2);

    expect(factor(stage, energy)).toBe(0.125);
    expect(factor(stage, stars)).toBe(0.25);
  });
});

describe("the step around a run", () => {
  // Bug: the idle check ignores the runs, so a delay with no record and no part never ends; or it never goes idle.
  it("keeps the step running for a run alone, then returns at once with the run back in the pool", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const splash = stage.overlay({ hud: "none", hudReturn: { delayMs: 100, fadeMs: 100 } });

    stage.level(splash, 1, true);
    stage.frames(2);
    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frames(3);

    const overlay = overlayOf(stage);

    expect([overlay.records.size, overlay.parts.size, overlay.returns.length]).toEqual([0, 0, 1]);

    stage.frame();
    expect([overlay.returns.length, overlay.returnPool.length]).toEqual([0, 1]);

    const wholes = vi.spyOn(stage.drawn.mock.modules.demand, "wholes");

    stage.frame();
    expect(wholes).not.toHaveBeenCalled();
  });

  // Bug: a run marks its parts in every frame (a frame drawn at rest), or a changed factor is not drawn.
  it("draws the frames where a factor moves and none while the delay waits or after the end", async () => {
    const { stage } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 200, fadeMs: 100 } });

    stage.drawn.mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    stage.frame();

    const drawn = [50, 50, 50, 50, 50, 50].map(() => stage.frame());

    expect(drawn).toEqual([false, false, false, true, true, false]);
  });

  // Bug: the loop drops to its idle rate while a delay waits with nothing moving, so the return starts late and fades
  // at the idle rate; or it wakes with no run.
  it("wakes the clock in a frame it marks idle while a run is in progress, and never without a run", async () => {
    const { stage } = await returnStage();
    const { mock } = stage.drawn;
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 200, fadeMs: 0 } });

    mock.setFrameDelta(50);
    leaveAndGo(stage, splash);

    const before = mock.time.wakes();

    stage.frame();
    expect(mock.time.wakes()).toBe(before);

    mock.setIdle(true);
    stage.frames(2);
    expect(mock.time.wakes()).toBe(before + 2);

    // 200 ms: the run ends in this step, and nothing wakes the clock any more.
    stage.frames(3);
    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(mock.time.wakes()).toBe(before + 2);
  });

  // Bug: the clock is woken in idle frames while no game time passes (a paused game, `time.setScale(0)`): each wake draws a
  // frame at full rate for a return that does not move.
  it("wakes nothing in idle frames while the game time stands still, and wakes again once it counts", async () => {
    const { stage } = await returnStage();
    const { mock } = stage.drawn;
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: 1000, fadeMs: 0 } });

    mock.setFrameDelta(50);
    leaveAndGo(stage, splash);
    mock.setTimeScale(0);
    mock.setIdle(true);

    const before = mock.time.wakes();

    stage.frames(3);
    expect(overlayOf(stage).returns.map(run => run.elapsed)).toEqual([0]);
    expect(mock.time.wakes()).toBe(before);

    mock.setTimeScale(1);
    stage.frames(2);
    expect(mock.time.wakes()).toBe(before + 2);
  });

  // Bug: the report misses the run, reports it on every overlay, or reports a run whose record is gone.
  it("reports the run on its overlay's line while the record is there, and nowhere once it is gone", async () => {
    const { stage } = await returnStage();
    const sync = stage.drawn.mock.api.sync;
    const shop = shown(stage, { hud: ["energy"] }, 2);
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH }, 3);

    stage.leave(splash);
    stage.frame();
    stage.frame();

    const [shopLine, splashLine] = sync.debug.overlays();

    expect(shopLine?.entity).toBe(shop);
    expect(shopLine !== undefined && "hudReturn" in shopLine).toBe(false);
    expect(splashLine?.hudReturn).toEqual({ delayMs: 1100, fadeMs: 700, elapsed: 16 });

    stage.drawn.mock.world.ecs.despawn(splash);
    stage.frame();
    expect(sync.debug.overlays().map(line => line.hudReturn)).toEqual([undefined]);
    expect(overlayOf(stage).returns).toHaveLength(1);
  });

  // Bug: the runs count before the root is checked: a renderer with no tree counts and wakes the loop every frame.
  // Bug: a stop keeps the runs and the pooled ones, holding the stopped app's overlay values.
  it("forgets every run and its pool at stop", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const { overlay } = stage.drawn.mock.ctx.state.sync;
    const first = stage.overlay({ hud: "none", hudReturn: SPLASH });
    const second = stage.overlay(
      { hud: "none", hudReturn: { delayMs: 0, fadeMs: 0 } },
      { order: 3 }
    );

    stage.level(first, 1, true);
    stage.level(second, 1, true);
    stage.frames(2);
    stage.leave(first);
    stage.leave(second);
    stage.frame();
    stage.frame();
    expect([overlay.returns.length, overlay.returnPool.length]).toEqual([1, 1]);

    stopNow(stage);
    expect([overlay.returns.length, overlay.returnPool.length]).toEqual([0, 0]);
  });

  // Bug: the walk of a run's end is a module-level object: one scratch shared by every app, holding the last overlay's
  // list and end past a stop.
  it("walks a run's end on its own state, holds no overlay's list after it, and clears it at stop", async () => {
    const { stage } = await returnStage();
    const overlay = overlayOf(stage);
    const splash = shown(stage, {
      hud: ["energy"],
      hudReturn: { delayMs: 100, fadeMs: 200, parts: { gems: { delayMs: 400 } } }
    });

    leaveAndGo(stage, splash);
    expect(overlay.returns[0]?.endsMs).toBe(600);
    expect(overlay.endsWalk).toEqual({ hud: "none", reduced: false, ends: 600 });

    stopNow(stage);
    expect(overlay.endsWalk).toEqual({ hud: "none", reduced: false, ends: 0 });
  });

  // Bug: the overlays are seen before the root is checked: an overlay that leaves while the tree is gone starts a run.
  it("counts nothing, wakes nothing and starts no run while the renderer has no tree", async () => {
    const stage = await startOverlayStage();
    const { mock } = stage.drawn;

    running.push(stage);

    stage.view({ layer: "hud", extra: [HudPart({ key: "energy" })] });

    const splash = stage.overlay({ hud: "none", hudReturn: SPLASH });
    const sheet = stage.overlay({ hud: "none", hudReturn: SPLASH }, { order: 3 });

    stage.level(splash, 1, true);
    stage.level(sheet, 1, true);
    stage.frames(2);
    leaveAndGo(stage, splash);

    const { returns } = overlayOf(stage);
    const run = returns[0];
    const before = mock.time.wakes();

    // A lost device: the tree is gone until a restore, and the sheet starts its leave meanwhile.
    mock.modules.sync.forget();
    stage.leave(sheet);
    mock.setIdle(true);
    mock.modules.sync.stepOverlays();
    mock.modules.sync.stepOverlays();

    expect(returns).toEqual([run]);
    expect(run?.elapsed).toBe(0);
    expect(mock.time.wakes()).toBe(before);
  });
});

describe("the hudReturn value", () => {
  // Bug: a value that is no object of finite times reaches the arithmetic (NaN factors, a run that never ends), or
  // warns in every frame.
  it.each<[string, unknown]>([
    ["text", "soon"],
    ["no fadeMs", { delayMs: 100 }],
    ["a NaN delay", { delayMs: Number.NaN, fadeMs: 100 }],
    ["a part's text delay", { delayMs: 100, fadeMs: 100, parts: { gems: { delayMs: "late" } } }]
  ])("treats %s as absent and warns once in a dev build", async (_name, hudReturn) => {
    const { stage, energy } = await returnStage({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const splash = shown(stage, { hud: "none", hudReturn: hudReturn as HudReturn });

    stage.frames(3);
    leaveAndGo(stage, splash);
    stage.frame();

    expect(overlayOf(stage).returns).toHaveLength(0);
    expect(factor(stage, energy)).toBe(1);
    expect(
      warn.mock.calls.filter(([code]) => code === "renderer:overlay-hud-return-ignored")
    ).toEqual([["renderer:overlay-hud-return-ignored", { entity: splash }]]);
  });

  // Bug: a negative time is refused as malformed, or kept negative (the part back before the leave).
  it("clamps a negative delay to 0: the fade starts with the leave", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: { delayMs: -50, fadeMs: 320 } });

    leaveAndGo(stage, splash);
    stage.frame();
    expect(factor(stage, energy)).toBe(0.05);
  });

  // Bug: a new reference with the same times copies and clamps again (a Map and objects at every render of an inline
  // literal); or a value whose times differ in any field keeps the old copy.
  it.each<[string, HudReturn, boolean]>([
    ["the same times", { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1250 } } }, false],
    ["another delay", { delayMs: 1000, fadeMs: 700, parts: { gems: { delayMs: 1250 } } }, true],
    ["another fade", { delayMs: 1100, fadeMs: 600, parts: { gems: { delayMs: 1250 } } }, true],
    [
      "another part's delay",
      { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1300 } } },
      true
    ],
    [
      "a part's fade added",
      { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1250, fadeMs: 700 } } },
      true
    ],
    [
      "a part more",
      { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1250 }, stars: {} } },
      true
    ],
    ["a part less", { delayMs: 1100, fadeMs: 700, parts: {} }, true],
    ["no parts", { delayMs: 1100, fadeMs: 700 }, true]
  ])("a new value with %s (%j) is copied again: %s", async (_name, next, copies) => {
    const { stage } = await returnStage();
    const before: HudReturn = { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1250 } } };
    const splash = shown(stage, { hud: "none", hudReturn: before });
    const copyOf = () => overlayOf(stage).records.get(splash)?.hudReturn;
    const copy = copyOf();

    stage.drawn.mock.world.ecs.set(splash, Overlay, { hudReturn: next });
    stage.frame();

    expect(copy).toBeDefined();
    expect(copyOf() !== copy).toBe(copies);
    expect(copyOf()?.delayMs).toBe(next.delayMs);
    expect([...(copyOf()?.parts?.keys() ?? [])]).toEqual(Object.keys(next.parts ?? {}));
  });

  // Bug: a malformed value whose `parts` holds every key of the copy's and one more that holds nothing is taken for it:
  // the old times stay, not none.
  it("drops the copy for a malformed value whose parts add a key that holds nothing", async () => {
    const { stage } = await returnStage();
    const before: HudReturn = { delayMs: 1100, fadeMs: 700, parts: { gems: { delayMs: 1250 } } };
    const splash = shown(stage, { hud: "none", hudReturn: before });
    const malformed: unknown = {
      delayMs: 1100,
      fadeMs: 700,
      parts: { gems: { delayMs: 1250 }, stars: undefined }
    };

    stage.drawn.mock.world.ecs.set(splash, Overlay, { hudReturn: malformed as HudReturn });
    stage.frame();

    expect(overlayOf(stage).records.get(splash)?.hudReturn).toBeUndefined();
  });

  // Bug: the copy is made once with the record, so a value written later is never read.
  it("reads a new value written while the overlay stands", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: SPLASH });

    stage.drawn.mock.world.ecs.set(splash, Overlay, { hudReturn: { delayMs: 0, fadeMs: 32 } });
    stage.frame();
    leaveAndGo(stage, splash);
    stage.frame();

    expect(factor(stage, energy)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// F245: `hudReturn` takes a curve (`ease`) and a walk (`keyframes`). The curve shapes the factor, kept within 0..1; the
// walk poses each held part from its first key to rest over the fade, drawn on its top, never in its `Transform`.
// ---------------------------------------------------------------------------

/** exam-in of the game's motion table: 8 units above, down to rest over 700 ms on cubic-bezier(.25, .6, .3, 1). */
const EXAM_IN: HudReturn = {
  delayMs: 1100,
  fadeMs: 700,
  ease: [0.25, 0.6, 0.3, 1],
  keyframes: [{ at: 0, Transform: { dy: -8 } }]
};

/** The precision of a value read on the engine's bezier table, which is within 1e-4 of the exact curve. */
const CURVE_DIGITS = 3;

/**
 * The clamped copy of a value that can be read.
 *
 * @param value - The value.
 * @returns Its copy.
 */
function copyOf(value: unknown): ClampedHudReturn {
  const copy = clampedReturn(value);

  if (copy === undefined) throw new Error("the value cannot be read");

  return copy;
}

/**
 * The pose a value's own walk stands at, at a share of its fade.
 *
 * @param value - The value, with readable keys.
 * @param share - The share of the fade.
 * @returns The six numbers: dx, dy, rotation, scale, scaleX, scaleY.
 */
function poseAt(value: HudReturn, share: number): number[] {
  const copy = copyOf(value);
  const pose = new Float64Array(6);

  if (copy.keys === undefined) throw new Error("the value has no walk");

  samplePose(copy.keys, copy.curve, share, pose);

  return [...pose];
}

/**
 * Where the top of a part's view stands now.
 *
 * @param stage - The stage.
 * @param entity - The part.
 * @returns Its y.
 */
function topY(stage: OverlayStage, entity: Entity): number {
  return stage.topOf(entity).position.y;
}

describe("F245: the curve of the return factor", () => {
  // Bug: the curve is ignored (0.25, 0.5, 0.75 drawn), or a tuple is solved with its numbers in another order.
  it.each([
    [1100, 0],
    [1275, 0.596],
    [1450, 0.884],
    [1625, 0.979],
    [1800, 1]
  ])("draws exam-in at %i ms with %d", (elapsed, expected) => {
    const { curve } = copyOf(EXAM_IN);

    expect(returnFactor(elapsed, 1100, 700, curve)).toBeCloseTo(expected, CURVE_DIGITS);
  });

  // Bug: a value without `ease` gets a default curve that is not linear: every F240 number moves.
  it("stays linear without ease: 0.25 and 0.5 a quarter and half into the fade", () => {
    const { curve } = copyOf({ delayMs: 1100, fadeMs: 700 });

    expect([returnFactor(1275, 1100, 700, curve), returnFactor(1450, 1100, 700, curve)]).toEqual([
      0.25, 0.5
    ]);
  });

  // Bug: an overshooting curve reaches the alpha unclamped: a negative alpha, or one above 1.
  it("keeps the factor within 0..1: inBack at 0.1 is 0, outBack at 0.5 is 1", () => {
    const inBack = copyOf({ delayMs: 0, fadeMs: 100, ease: "inBack" }).curve;
    const outBack = copyOf({ delayMs: 0, fadeMs: 100, ease: "outBack" }).curve;

    expect([returnFactor(10, 0, 100, inBack), returnFactor(50, 0, 100, outBack)]).toEqual([0, 1]);
  });
});

describe("F245: the copy of ease and keyframes", () => {
  // Bug: a named curve is read as linear, or kept as something `easeCell` does not know.
  it("eases by a name: outCubic is 0.875 halfway", () => {
    const copy = copyOf({ delayMs: 0, fadeMs: 100, ease: "outCubic" });

    expect([copy.curve, copy.badEase, returnFactor(50, 0, 100, copy.curve)]).toEqual([
      { name: "outCubic" },
      false,
      0.875
    ]);
  });

  // Bug: a curve that cannot be read throws (cubicBezier refuses x1 1.2), drops the whole value, or is kept.
  it.each<[string, unknown]>([
    ["x1 1.2", [1.2, 0, 0.3, 1]],
    ["x2 below 0", [0.25, 0.6, -0.1, 1]],
    ["three numbers", [0.25, 0.6, 0.3]],
    ["a NaN y", [0.25, Number.NaN, 0.3, 1]],
    ["a number", 0.5],
    ["a function", (t: number) => t],
    ["an unknown name", "bounce"]
  ])("reads %s as linear and notes it, the times kept", (_name, ease) => {
    const copy = copyOf({ delayMs: 100, fadeMs: 700, ease });

    expect([copy.badEase, copy.badEasePart, copy.delayMs, copy.fadeMs]).toEqual([
      true,
      undefined,
      100,
      700
    ]);
    expect(returnFactor(450, 100, 700, copy.curve)).toBe(0.5);
  });

  // Bug: a key's curve that cannot be read drops the walk, or passes unnoted.
  it("reads a key's curve that cannot be read as linear, the walk kept", () => {
    const copy = copyOf({
      delayMs: 0,
      fadeMs: 100,
      keyframes: [
        { at: 0, Transform: { dy: -8 } },
        { at: 0.5, ease: "bounce", Transform: { dy: 0 } }
      ]
    });

    expect([copy.badEase, copy.badKeys, copy.keys?.count]).toEqual([true, false, 2]);
  });

  // Bug: keys that cannot be read are walked (NaN poses, a walk backwards), or they cut the fade as well.
  it.each<[string, unknown]>([
    ["no key", []],
    ["keys out of order", [{ at: 0.5 }, { at: 0.25 }]],
    ["two keys at one at", [{ at: 0.5 }, { at: 0.5 }]],
    ["an at of 1.5", [{ at: 1.5 }]],
    ["a NaN dy", [{ at: 0, Transform: { dy: Number.NaN } }]],
    ["a key that is text", ["soon"]],
    ["a Transform that is text", [{ at: 0, Transform: "up" }]],
    ["keys that are no list", { at: 0 }]
  ])("walks nothing for %s and notes it, the fade kept", (_name, keyframes) => {
    const copy = copyOf({ delayMs: 100, fadeMs: 700, keyframes });

    expect([copy.badKeys, copy.badKeysPart, copy.keys, copy.fadeMs]).toEqual([
      true,
      undefined,
      undefined,
      700
    ]);
  });

  // Bug: a key of `parts` without its own curve or keys walks linear and still (the overlay's lost), or one with its
  // own takes the overlay's anyway; or a bad part's keys are blamed on the overlay.
  it("gives a key of parts its own ease and keyframes, and the overlay's to a key without them", () => {
    const copy = copyOf({
      delayMs: 0,
      fadeMs: 100,
      ease: "in",
      keyframes: [{ at: 0, Transform: { dy: -8 } }],
      parts: {
        gems: { ease: "out", keyframes: [{ at: 0, Transform: { dx: 5 } }] },
        stars: { delayMs: 50 },
        coins: { keyframes: [] }
      }
    });
    const gems = copy.parts?.get("gems");
    const stars = copy.parts?.get("stars");
    const pose = new Float64Array(6);

    expect(gems?.curve).toEqual({ name: "out" });
    expect([stars?.curve, stars?.keys]).toEqual([copy.curve, copy.keys]);
    expect(stars?.keys).toBe(copy.keys);

    if (gems?.keys === undefined) throw new Error("gems has no walk");

    samplePose(gems.keys, gems.curve, 0, pose);
    expect([pose[0], pose[1]]).toEqual([5, 0]);
    expect([copy.badKeys, copy.badKeysPart, copy.parts?.get("coins")?.keys]).toEqual([
      true,
      "coins",
      undefined
    ]);
  });
});

describe("F245: the pose of a walk", () => {
  // Bug: the walk starts at rest, or is not on the return's curve, or ends off rest.
  it("walks exam-in from -8 at its start to -0.93 halfway and 0 at its end", () => {
    expect(poseAt(EXAM_IN, 0)).toEqual([0, -8, 0, 1, 1, 1]);
    expect(poseAt(EXAM_IN, 0.5)[1]).toBeCloseTo(-0.93, 2);
    expect(poseAt(EXAM_IN, 1)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  // Bug: before its first `at` the part walks from rest; a segment eases by the key it starts on or the return's curve;
  // the last segment does not go to rest.
  it("holds the first key before its at, eases a segment by its end key, and runs the last one to rest", () => {
    const track: HudReturn = {
      delayMs: 0,
      fadeMs: 100,
      keyframes: [
        { at: 0.25, Transform: { dy: -10 } },
        { at: 0.75, ease: "in", Transform: { dy: 10 } }
      ]
    };

    expect(poseAt(track, 0.1)[1]).toBe(-10);
    // Halfway from 0.25 to 0.75 on "in": 0.25 of the way, -10 + 20 × 0.25.
    expect(poseAt(track, 0.5)[1]).toBe(-5);
    // Halfway from the last key to rest on the return's own linear curve.
    expect(poseAt(track, 0.875)[1]).toBe(5);
  });

  // Bug: a key at 1 is walked to as a pose (the part ends 50 off), or its curve is lost.
  it("takes a key at 1 for the last segment's curve, not for a pose", () => {
    const track: HudReturn = {
      delayMs: 0,
      fadeMs: 100,
      keyframes: [
        { at: 0, Transform: { dy: -8 } },
        { at: 1, ease: "in", Transform: { dy: 50 } }
      ]
    };

    // Halfway on "in": a quarter of the way from -8 to rest.
    expect(poseAt(track, 0.5)[1]).toBe(-6);
    expect(poseAt(track, 0.999)[1]).toBeLessThan(0);
  });

  // Bug: a field a later key names first stands on its value from the start, or as 0 (a scale of 0 hides the part).
  it("keeps a field at rest before the key that first names it, then walks it there", () => {
    const track: HudReturn = {
      delayMs: 0,
      fadeMs: 100,
      keyframes: [
        { at: 0.5, Transform: { dy: -8 } },
        { at: 0.75, Transform: { scale: 0.8 } }
      ]
    };

    expect(poseAt(track, 0.25)).toEqual([0, -8, 0, 1, 1, 1]);
    // Halfway from 0.5 to 0.75: the scale halfway from rest to 0.8, the offset the first key's, held.
    expect(poseAt(track, 0.625)[1]).toBe(-8);
    expect(poseAt(track, 0.625)[3]).toBeCloseTo(0.9, 12);
  });

  // Bug: the pose is clamped with the factor, so an overshooting walk stops at rest.
  it("carries the pose past rest on outBack while the factor stays at 1", () => {
    const overshoot: HudReturn = { ...EXAM_IN, delayMs: 0, fadeMs: 100, ease: "outBack" };
    const copy = copyOf(overshoot);

    expect(poseAt(overshoot, 0.5)[1]).toBeGreaterThan(0);
    expect(returnFactor(50, 0, 100, copy.curve)).toBe(1);
  });
});

/**
 * A value with a curve and keys at the top and in `parts`, new at each call.
 *
 * @returns The value.
 */
function written(): HudReturn {
  return {
    delayMs: 1100,
    fadeMs: 700,
    ease: [0.25, 0.6, 0.3, 1],
    keyframes: [
      { at: 0, Transform: { dy: -8 } },
      { at: 0.5, ease: "out", Transform: { dy: -2 } }
    ],
    parts: { gems: { ease: "inCubic", keyframes: [{ at: 0, Transform: { dx: 4 } }] } }
  };
}

/**
 * The overlay's own keys of a value.
 *
 * @param value - The value.
 * @returns Its keys, none without.
 */
function keys(value: HudReturn): readonly HudReturnKey[] {
  return value.keyframes ?? [];
}

describe("F245: the same value with ease and keyframes", () => {
  // Bug: an inline literal written again is copied again: a curve solved and keys flattened every render.
  it("is the same for an equal value written again", () => {
    expect(sameReturn(written(), written())).toBe(true);
  });

  // Bug: a change in a curve or a key keeps the old copy, so the part walks the old motion.
  it.each<[string, (value: HudReturn) => HudReturn]>([
    ["a number of the tuple", value => ({ ...value, ease: [0.25, 0.6, 0.35, 1] })],
    ["a name for the tuple", value => ({ ...value, ease: "out" })],
    [
      "a key's at",
      value => ({
        ...value,
        keyframes: [{ at: 0.1, Transform: { dy: -8 } }, ...keys(value).slice(1)]
      })
    ],
    [
      "a key's dy",
      value => ({
        ...value,
        keyframes: [{ at: 0, Transform: { dy: -12 } }, ...keys(value).slice(1)]
      })
    ],
    [
      "a key's ease",
      value => ({
        ...value,
        keyframes: [keys(value)[0] ?? { at: 0 }, { at: 0.5, ease: "in", Transform: { dy: -2 } }]
      })
    ],
    [
      "the keys of a part",
      value => ({
        ...value,
        parts: { gems: { ease: "inCubic", keyframes: [{ at: 0, Transform: { dx: 6 } }] } }
      })
    ],
    [
      "the curve of a part",
      value => ({
        ...value,
        parts: { gems: { ease: "in", keyframes: [{ at: 0, Transform: { dx: 4 } }] } }
      })
    ],
    [
      "no keyframes",
      value => ({ delayMs: 1100, fadeMs: 700, ease: [0.25, 0.6, 0.3, 1], parts: value.parts ?? {} })
    ],
    ["a key more", value => ({ ...value, keyframes: [...keys(value), { at: 0.8 }] })]
  ])("is not the same with %s changed", (_name, change) => {
    expect(sameReturn(change(written()), written())).toBe(false);
  });
});

describe("F245: the walk on the stage", () => {
  // Bug: the pose is written into the ECS Transform (layout and snapshots move), drawn on another node, or the alpha
  // is not on the curve (the oracle of every frame compares it with the run's own curve).
  it("draws exam-in on the part's top: rest - 8 at 1100 ms, on the curve, rest from 1800 ms; its Transform stays", async () => {
    const { stage, energy } = await returnStage();
    const ecs = stage.drawn.mock.world.ecs;
    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN });

    leaveAndGo(stage, splash);
    step(stage, 1100);
    expect([topY(stage, energy), factor(stage, energy)]).toEqual([92, 0]);

    step(stage, 175);
    expect(topY(stage, energy)).toBeCloseTo(100 - 3.23, 2);
    expect(factor(stage, energy)).toBeCloseTo(0.596, CURVE_DIGITS);

    step(stage, 175);
    expect(topY(stage, energy)).toBeCloseTo(100 - 0.93, 2);
    expect(factor(stage, energy)).toBeCloseTo(0.884, CURVE_DIGITS);

    step(stage, 350);
    expect([topY(stage, energy), factor(stage, energy)]).toEqual([100, 1]);
    step(stage, 16);
    expect(topY(stage, energy)).toBe(100);
    expect(ecs.get(energy, Transform)?.y).toBe(100);
  });

  // Bug: reduced motion keeps the walk (the part slides in), or cuts the delay too.
  it("stands at rest at alpha 1 from the delay under reduced motion, on its first key before it", async () => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN });

    stage.drawn.mock.api.sync.leave.setReducedMotion(true);
    leaveAndGo(stage, splash);
    step(stage, 1099);
    expect([topY(stage, energy), factor(stage, energy)]).toEqual([92, 0]);
    step(stage, 1);
    expect([topY(stage, energy), factor(stage, energy)]).toEqual([100, 1]);
  });

  // Bug: a fade of 0 divides by zero (a NaN pose) or walks a frame past the delay.
  it("stands at rest from the delay with a fade of 0", async () => {
    const { stage, energy } = await returnStage();
    const late = { ...EXAM_IN, fadeMs: 0, parts: { stars: { delayMs: 5000 } } };
    const splash = shown(stage, { hud: "none", hudReturn: late });

    leaveAndGo(stage, splash);
    step(stage, 1099);
    expect(topY(stage, energy)).toBe(92);
    step(stage, 1);
    expect(topY(stage, energy)).toBe(100);
  });

  // Bug: a cut run leaves the part where its walk stood: the same overlay shown again, a new scene.
  it.each<[string, (stage: OverlayStage, splash: Entity) => void]>([
    [
      "the same overlay showing again",
      (stage, splash) => stage.drawn.mock.world.ecs.untag(splash, Exiting)
    ],
    ["new layers", stage => stage.drawn.mock.world.projection.setLayers([...OVERLAY_LAYERS])]
  ])("puts the part at rest at once for %s mid-walk", async (_name, cut) => {
    const { stage, energy } = await returnStage();
    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN });

    stage.leave(splash);
    stage.level(splash, 0.5);
    stage.frame();
    step(stage, 1450);
    expect(topY(stage, energy)).toBeLessThan(100);

    cut(stage, splash);
    stage.frame();
    expect(topY(stage, energy)).toBe(100);
  });

  // Bug: a part that leaves the HUD mid-walk keeps its offset for good: nothing writes it again.
  it("puts a part at rest when it loses HudPart mid-walk, and when it moves out of the HUD layer", async () => {
    const { stage, energy, gems } = await returnStage();
    const ecs = stage.drawn.mock.world.ecs;
    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN });

    leaveAndGo(stage, splash);
    step(stage, 1450);
    expect([topY(stage, energy), topY(stage, gems)].every(y => y < 100)).toBe(true);

    ecs.remove(energy, HudPart);
    expect(topY(stage, energy)).toBe(100);

    ecs.set(gems, Layer, { name: "ui" });
    step(stage, 16);
    expect([topY(stage, energy), topY(stage, gems)]).toEqual([100, 100]);
  });

  // Bug: a move of the part's own Transform writes its top without the walk's offset, and a pose that stands still
  // (the first key held through the delay) is never drawn again: the part jumps to its rest place mid-walk.
  it("keeps the walk's offset on a part whose Transform moves while its first key is held", async () => {
    const { stage, energy } = await returnStage();
    const ecs = stage.drawn.mock.world.ecs;
    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN });

    leaveAndGo(stage, splash);
    step(stage, 500);
    expect(topY(stage, energy)).toBe(92);

    ecs.set(energy, Transform, { y: 140 });
    step(stage, 16);
    expect(topY(stage, energy)).toBe(132);
  });

  // Bug: the last run's pose wins over the others, or the scale is added instead of multiplied with the part's own.
  it("adds the offsets of two runs that hold a part, and multiplies a scale with the part's own", async () => {
    const { stage, energy } = await returnStage();
    const ecs = stage.drawn.mock.world.ecs;

    ecs.set(energy, Transform, { scale: 2 });

    const splash = shown(stage, { hud: "none", hudReturn: EXAM_IN }, 2);
    const sheet = shown(
      stage,
      {
        hud: "none",
        hudReturn: { ...EXAM_IN, keyframes: [{ at: 0, Transform: { dy: -4, scale: 0.8 } }] }
      },
      3
    );

    stage.leave(splash);
    stage.leave(sheet);
    stage.frame();
    ecs.despawn(splash);
    ecs.despawn(sheet);
    stage.frame();

    expect(topY(stage, energy)).toBe(88);
    expect(stage.topOf(energy).scale.x).toBeCloseTo(1.6, 12);
    expect(ecs.get(energy, Transform)?.scale).toBe(2);
  });

  // Bug: a part at factor 1 takes a tap while its walk still moves it (outBack is at 1 early).
  it("gives a part still walking on outBack no tap at factor 1, and a tap once at rest", async () => {
    const { stage, energy } = await returnStage();
    const sync = stage.drawn.mock.api.sync;
    const tap = (): Entity | undefined => sync.hitTest(150, 150, entity => entity === energy);
    const value: HudReturn = { ...EXAM_IN, delayMs: 0, fadeMs: 200, ease: "outBack" };
    const splash = shown(stage, { hud: "none", hudReturn: value });

    leaveAndGo(stage, splash);
    step(stage, 100);
    expect(factor(stage, energy)).toBe(1);
    expect(topY(stage, energy)).not.toBe(100);
    expect(overlayOf(stage).offTops.has(stage.topOf(energy))).toBe(true);
    expect(tap()).toBeUndefined();

    step(stage, 100);
    expect(topY(stage, energy)).toBe(100);
    expect(tap()).toBe(energy);
  });

  // Bug: a bad curve or bad keys pass silently, warn every frame, are taken for an unreadable value (no return at all),
  // or the curve is not linear.
  it("warns once per overlay for a bad curve and for bad keys, and returns linear with no walk", async () => {
    const { stage, energy, gems } = await returnStage({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const bad = {
      delayMs: 0,
      fadeMs: 700,
      ease: [1.2, 0, 0.3, 1],
      keyframes: [{ at: 0, Transform: { dy: -8 } }],
      parts: { gems: { keyframes: [] } }
    } as const;
    const splash = shown(stage, { hud: "none", hudReturn: bad });
    const codes = new Set(["renderer:hud-return-ease", "renderer:hud-return-keys"]);

    stage.drawn.mock.world.ecs.set(splash, Overlay, {
      hudReturn: { ...bad, ease: [1.3, 0, 0.3, 1] }
    });
    stage.frames(2);
    leaveAndGo(stage, splash);
    step(stage, 350);

    expect(warn.mock.calls.filter(([code]) => codes.has(code))).toEqual([
      ["renderer:hud-return-ease", { entity: splash, label: expect.any(String), part: undefined }],
      ["renderer:hud-return-keys", { entity: splash, label: expect.any(String), part: "gems" }]
    ]);
    expect(warn.mock.calls.some(([code]) => code === "renderer:overlay-hud-return-ignored")).toBe(
      false
    );
    // Linear halfway; the energy walks the overlay's keys, the gems' own bad keys walk nothing.
    expect([factor(stage, energy), factor(stage, gems)]).toEqual([0.5, 0.5]);
    expect([topY(stage, energy), topY(stage, gems)]).toEqual([96, 100]);
  });

  // Bug: a bad curve of a key of `parts` is blamed on the overlay (no part in the warning), turns the overlay's own
  // curve linear for every part, or is kept on that part.
  it("names the key of parts with a bad curve, draws that part linear and the others on the overlay's", async () => {
    const { stage, energy, gems } = await returnStage({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const value = { delayMs: 0, fadeMs: 700, ease: "in", parts: { gems: { ease: "bounce" } } };
    const splash = shown(stage, { hud: "none", hudReturn: value as HudReturn });

    expect(copyOf(value).badEasePart).toBe("gems");

    leaveAndGo(stage, splash);
    step(stage, 350);

    expect(warn.mock.calls.filter(([code]) => code === "renderer:hud-return-ease")).toEqual([
      ["renderer:hud-return-ease", { entity: splash, label: expect.any(String), part: "gems" }]
    ]);
    // Halfway: the energy on the overlay's "in" (0.5²), the gems linear.
    expect([factor(stage, energy), factor(stage, gems)]).toEqual([0.25, 0.5]);
  });
});
