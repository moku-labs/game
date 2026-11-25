import { afterEach, describe, expect, it, vi } from "vitest";
import { Exiting } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { HudPart, type HudReturn, Overlay, type OverlayValue } from "../../components";
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

    stage.drawn.mock.stop();
    expect([overlay.returns.length, overlay.returnPool.length]).toEqual([0, 0]);
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
