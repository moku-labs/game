/* eslint-disable unicorn/no-null -- the report says `null` for no entity behind a take. */
import * as pixi from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import type * as HostApi from "../../host/api";
import { KEY } from "../../kept/geometry";
import { type KeptRecord, RETAKE } from "../../kept/types";
import type { FilterSlot, FilterSlotInputs, PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// F126 stage 1: a step of the renderer resolution keeps kept pictures (spec 23 P2.5, P4.3). A step down owes nothing, a
// step up is paid a few a flush, and a settle shares the limit, with or without a step. The whole renderer over the real
// Pixi of `stagePixi`; a test counts the renders into the textures of the pictures.
// ---------------------------------------------------------------------------

/** The label of the texture `host.renderTo` refuses, `undefined` for none. */
const refused = vi.hoisted(() => ({ label: undefined as string | undefined }));

// The renderer builds its modules more than once, each with a host of its own: only here does one render fail.
vi.mock("../../host/api", async importOriginal => {
  const original = await importOriginal<typeof HostApi>();

  return {
    ...original,
    createHostApi: (...options: Parameters<typeof original.createHostApi>) => {
      const host = original.createHostApi(...options);
      const renderTo: typeof host.renderTo = (container, target, transform, clear) =>
        target.source.label !== refused.label && host.renderTo(container, target, transform, clear);

      return { ...host, renderTo };
    }
  };
});

const running: Drawn[] = [];

/**
 * The renderers of a test with an outer picture that waits under the limit for its inner ones: for those flushes it
 * holds their last texture, by design (P4.3), which the tree oracle reads as not current.
 */
const outerWaited = new Set<Drawn>();

/** The clock of the test: `second` moves it. */
const clock = { now: 0 };

beforeEach(() => {
  clock.now = 0;
});

afterEach(() => {
  for (const drawn of running.splice(0)) {
    if (!outerWaited.has(drawn)) drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  outerWaited.clear();
  refused.label = undefined;

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Starts an agent build and keeps it for the teardown.
 *
 * @param onDemand - `config.onDemand`; every frame is drawn when left out.
 * @returns The running renderer.
 */
async function open(onDemand = false): Promise<Drawn> {
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);

  const drawn = await startDrawn({ onDemand });

  running.push(drawn);

  return drawn;
}

/**
 * Applies a resolution before anything else of a test: the next frames draw at it.
 *
 * @param drawn - The running renderer.
 * @param resolution - Device pixels per CSS px.
 */
function setResolution(drawn: Drawn, resolution: number): void {
  drawn.mock.api.monitor.setResolution(resolution);
}

/**
 * A slot whose filter draws at the canvas resolution, as `effects` hands its filters.
 *
 * @returns The slot.
 */
function inherit(): FilterSlot {
  const filter = new pixi.ColorMatrixFilter();

  filter.resolution = "inherit";

  return { filter, passes: 1, cache: "local" };
}

/**
 * A slot whose filter draws at a resolution of its own.
 *
 * @param resolution - Its resolution.
 * @returns The slot.
 */
function fixedAt(resolution: number): FilterSlot {
  const filter = new pixi.ColorMatrixFilter();

  filter.resolution = resolution;

  return { filter, passes: 1, cache: "local" };
}

/**
 * A slot of a stack of alphas drawn direct.
 *
 * @param resolution - Its resolution.
 * @returns The slot.
 */
function alphaAt(resolution: number | "inherit"): FilterSlot {
  const filter = new pixi.AlphaFilter({ alpha: 0.5 });

  filter.resolution = resolution;

  return { filter, passes: 1, cache: "local" };
}

/**
 * The state of the kept cache.
 *
 * @param drawn - The running renderer.
 * @returns The state.
 */
function keptOf(drawn: Drawn): Drawn["mock"]["ctx"]["state"]["kept"] {
  return drawn.mock.ctx.state.kept;
}

/**
 * The record of an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Its record.
 */
function recordOf(drawn: Drawn, entity: Entity): KeptRecord {
  const record = keptOf(drawn).byEntity.get(entity);

  if (record === undefined) throw new Error(`no record for ${entity}`);

  return record;
}

/**
 * Runs frames until every record of the cache is kept.
 *
 * @param drawn - The running renderer.
 * @param tick - One frame: a plain one when every frame is drawn, a lamp's under `onDemand`.
 */
function takeAll(drawn: Drawn, tick: () => void = () => drawn.frame()): void {
  const { records } = keptOf(drawn);

  for (let frame = 0; frame < 120; frame += 1) {
    tick();

    if (records.every(record => record.mode === "kept")) return;
  }

  throw new Error("a picture was not taken");
}

/**
 * Spawns a grid of 40 x 40 filtered views on whole pixels and takes their pictures.
 *
 * @param drawn - The running renderer.
 * @param count - The views.
 * @param slot - Makes the filter slot of a view, or its slots.
 * @param tick - One frame, as `takeAll`.
 * @returns The entities, kept.
 */
function pictures(
  drawn: Drawn,
  count: number,
  slot: () => FilterSlot | FilterSlot[] = inherit,
  tick?: () => void
): Entity[] {
  const entities = Array.from({ length: count }, (_view, index) =>
    drawn.spawn(
      Transform({ x: (index % 5) * 200 + 100, y: Math.floor(index / 5) * 100 + 100 }),
      Shape({ w: 40, h: 40 })
    )
  );

  drawn.frame();
  for (const entity of entities) drawn.mock.api.sync.filters.set(entity, [slot()].flat());
  takeAll(drawn, tick);

  return entities;
}

/**
 * The textures rendered into since a point of the log, by the end of their label.
 *
 * @param drawn - The running renderer.
 * @param from - The log length to count from.
 * @param stage - `#1` for the subtree picture, `#3` for the filter output.
 * @returns Their labels, in render order.
 */
function renders(drawn: Drawn, from: number, stage: "#1" | "#3"): string[] {
  return drawn.stage
    .targets()
    .slice(from)
    .map(call => call.target?.source.label ?? "")
    .filter(label => label.endsWith(stage));
}

/**
 * Runs frames and answers the stage-1 takes of each.
 *
 * @param drawn - The running renderer.
 * @param frames - The frames.
 * @param before - Runs before each frame, with its index.
 * @returns The takes per flush.
 */
function takesEach(drawn: Drawn, frames: number, before?: (frame: number) => void): number[] {
  const takes: number[] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    before?.(frame);
    drawn.frame();
    takes.push(keptOf(drawn).frameTakes);
  }

  return takes;
}

/**
 * Moves views by a distance on x.
 *
 * @param drawn - The running renderer.
 * @param entities - The views.
 * @param distance - CSS px.
 */
function pan(drawn: Drawn, entities: readonly Entity[], distance: number): void {
  for (const entity of entities) {
    const x = (drawn.mock.world.ecs.get(entity, Transform) as { x: number }).x;

    drawn.mock.world.ecs.set(entity, Transform, { x: x + distance });
  }
}

/**
 * A lamp that moves every frame: its mark draws a frame and makes every kept record step.
 *
 * @param drawn - The running renderer.
 * @returns One frame with the lamp a step further.
 */
function withLamp(drawn: Drawn): () => void {
  const lamp = drawn.spawn(Transform({ x: 900, y: 1500 }), Shape({ w: 8, h: 8 }));
  let x = 900;

  drawn.frame();

  return () => {
    x += 1;
    drawn.mock.world.ecs.set(lamp, Transform, { x });
    drawn.frame();
  };
}

/**
 * Tells a picture holds its grid: nothing owed, drawn at the canvas resolution, taken where it stands.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @param resolution - The canvas resolution.
 */
function expectSharp(drawn: Drawn, entity: Entity, resolution: number): void {
  const record = recordOf(drawn, entity);
  const x = (drawn.mock.world.ecs.get(entity, Transform) as { x: number }).x;

  expect(record).toMatchObject({ mode: "kept", coarse: false, settle: false });
  expect(record.key[KEY.r]).toBe(resolution);
  expect(record.key[KEY.tx]).toBe(x);
}

/** A panel and the pictures inside it. */
type Nested = { outer: Entity; inner: Entity[] };

/** Where a panel lies: its left edge and width, and how far in its pictures start. */
type Panel = { x: number; w: number; inset: number };

/** A panel inside the canvas. */
const WHOLE_PANEL: Panel = { x: 100, w: 500, inset: 20 };

/** A panel cut to the canvas on both sides, its pictures on it. */
const CUT_PANEL: Panel = { x: -100, w: 1400, inset: 120 };

/**
 * A kept panel holding kept pictures, all taken at the resolution of this frame.
 *
 * @param drawn - The running renderer.
 * @param count - The inner pictures.
 * @param outerSlot - The filter slot of the panel.
 * @param innerSlot - Makes the filter slot of an inner picture.
 * @param panel - Where the panel lies.
 * @returns The panel and the pictures.
 */
function nested(
  drawn: Drawn,
  count: number,
  outerSlot: FilterSlot = inherit(),
  innerSlot: () => FilterSlot = inherit,
  panel: Panel = WHOLE_PANEL
): Nested {
  const outer = drawn.spawn(Transform({ x: panel.x, y: 100 }), Shape({ w: panel.w, h: 200 }));
  const inner = Array.from({ length: count }, (_view, index) =>
    drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: panel.inset + (index % 5) * 80, y: 20 + Math.floor(index / 5) * 60 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: outer })
    ])
  );

  drawn.frame();
  drawn.mock.api.sync.filters.set(outer, [outerSlot]);
  for (const entity of inner) drawn.mock.api.sync.filters.set(entity, [innerSlot()]);
  takeAll(drawn);
  drawn.frames(3);

  return { outer, inner };
}

/**
 * Runs the frames that close the measuring window open now, so `why()` reports its takes.
 *
 * @param drawn - The running renderer.
 */
function second(drawn: Drawn): void {
  for (let frame = 0; frame < 2; frame += 1) {
    clock.now += 500;
    drawn.mock.setNow(clock.now);
    drawn.frame();
  }
}

/**
 * The last take `why()` reports for an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns What the report says.
 */
function whyOf(drawn: Drawn, entity: Entity): unknown {
  const label = drawn.mock.ctx.state.sync.views.get(entity)?.object.label;

  return drawn.mock.api.sync.debug.why().find(entry => entry.view === label)?.retake;
}

/**
 * A fake seam of a filter with one input, on a version a test moves.
 *
 * @returns The slot and the version.
 */
function chainSlot(): { slot: FilterSlot; version: { value: number } } {
  const version = { value: 1 };
  const inputs: FilterSlotInputs = {
    stages: [],
    count: 1,
    version: () => version.value,
    scaleOf: () => 0.5,
    draw: vi.fn(),
    hold: vi.fn()
  };

  return { slot: { ...inherit(), inputs }, version };
}

/**
 * The label of a picture's texture of a stage.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @param stage - `#1` or `#3`.
 * @returns The label.
 */
function textureLabel(drawn: Drawn, entity: Entity, stage: "#1" | "#3"): string {
  const top: PixiContainer = recordOf(drawn, entity).top;

  return `kept:${top.label}${stage}`;
}

/**
 * A kept picture on `"inherit"`, stepped down.
 *
 * @param slot - Its slot.
 * @returns The renderer and the entity.
 */
async function stale(slot: FilterSlot): Promise<{ drawn: Drawn; entity: Entity }> {
  const drawn = await open();

  setResolution(drawn, 2);

  const [entity] = pictures(drawn, 1, () => slot);

  setResolution(drawn, 1.5);
  drawn.frame();

  return { drawn, entity: entity as Entity };
}

/**
 * Tells the frame took a whole picture at the new resolution, its stage 1 before its stage 3.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @param from - The log length before the frame.
 */
function expectWhole(drawn: Drawn, entity: Entity, from: number): void {
  const labels = drawn.stage
    .targets()
    .slice(from)
    .map(call => call.target?.source.label ?? "");
  const first = textureLabel(drawn, entity, "#1");
  const { key } = recordOf(drawn, entity);

  expect(labels.filter(label => label === first)).toHaveLength(1);
  expect(labels.indexOf(first)).toBe(0);
  expect([key[KEY.rs], key[KEY.r]]).toEqual([1.5, 1.5]);
  expect(recordOf(drawn, entity).s1?.source.resolution).toBe(1.5);
}

/**
 * Runs four frames and answers the inner pictures taken in each.
 *
 * @param drawn - The running renderer.
 * @param inner - The inner pictures.
 * @returns The takes per flush, the outer's left out.
 */
function takesEachInner(drawn: Drawn, inner: readonly Entity[]): number[] {
  const labels = new Set(inner.map(entity => textureLabel(drawn, entity, "#1")));

  return [0, 1, 2, 3].map(() => {
    const from = drawn.stage.targets().length;

    drawn.frame();

    return renders(drawn, from, "#1").filter(label => labels.has(label)).length;
  });
}

/**
 * A kept picture on `"inherit"`, stepped down, and the root above it.
 *
 * @returns The renderer, the entity, the root and a lamp.
 */
async function steppedUnderRoot(): Promise<{
  drawn: Drawn;
  entity: Entity;
  root: PixiContainer;
  lamp: () => void;
}> {
  const drawn = await open();

  setResolution(drawn, 2);

  const [entity] = pictures(drawn, 1);
  const lamp = withLamp(drawn);

  setResolution(drawn, 1.5);
  drawn.frame();

  const { root } = drawn.mock.ctx.state.sync;

  if (root === undefined) throw new Error("no root");

  return { drawn, entity: entity as Entity, root, lamp };
}

/**
 * A dev build whose extract answers a frame drawn from a picture other than the same frame drawn live.
 *
 * @returns The renderer and the kept picture.
 */
async function differing(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false, dev: true });

  running.push(drawn);
  drawn.stage.last().renderer.extract.pixels = () => ({
    pixels: new Uint8ClampedArray(64).fill(keptOf(drawn).bypassed ? 255 : 128),
    width: 4,
    height: 4
  });

  return drawn;
}

/**
 * The stale-picture lines the log got.
 *
 * @param drawn - The running renderer.
 * @returns Their count.
 */
function staleLines(drawn: Drawn): number {
  return vi
    .mocked(drawn.mock.log.warn)
    .mock.calls.filter(([event]) => event === "renderer:stale-picture").length;
}

describe("a step down", () => {
  // Bug: the storm is back: every picture retaken in one flush, 137 ms of GPU on the phone.
  it("takes and refreshes nothing for 40 pictures, and the step frame adds no pass", async () => {
    const drawn = await open();

    setResolution(drawn, 2);

    const entities = pictures(drawn, 40);
    const versions = entities.map(entity => recordOf(drawn, entity).s1Version);
    const from = drawn.stage.targets().length;

    drawn.frames(3);
    expect(keptOf(drawn).flushPasses).toBe(0);

    setResolution(drawn, 1.5);
    drawn.frame();

    expect(keptOf(drawn).flushPasses).toBe(0);
    drawn.frames(3);

    expect(drawn.stage.targets().length).toBe(from);
    expect(entities.map(entity => recordOf(drawn, entity).s1Version)).toEqual(versions);
    expect(recordOf(drawn, entities[0] as Entity).key[KEY.r]).toBe(2);
  });

  // Bug: a picture retaken although it matches the canvas again.
  it("and the step back to the taken resolution take nothing", async () => {
    const drawn = await open();

    setResolution(drawn, 2);

    const entities = pictures(drawn, 6);
    const from = drawn.stage.targets().length;

    setResolution(drawn, 1.5);
    drawn.frames(2);
    setResolution(drawn, 2);
    drawn.frames(3);

    expect(drawn.stage.targets().length).toBe(from);
    expect(entities.some(entity => recordOf(drawn, entity).settle)).toBe(false);
  });
});

describe("a step up", () => {
  // Bug: the limit off by one, or a picture left behind.
  it.each([
    [4, [4, 0]],
    [5, [4, 1]],
    [10, [4, 4, 2, 0]]
  ])("takes %i pictures %j a flush, each at the new resolution", async (count, expected) => {
    const drawn = await open();
    const entities = pictures(drawn, count);

    setResolution(drawn, 2);

    expect(takesEach(drawn, expected.length)).toEqual(expected);

    for (const entity of entities) {
      expectSharp(drawn, entity, 2);
      expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.resolution);
    }
  });

  // Bug: `stepCalm` skips the debt, the pictures stay coarse for ever, or the last flush keeps the frames coming.
  it("under onDemand and no mark asks for a frame while a debt stands, and for none after", async () => {
    const drawn = await open(true);
    const lamp = withLamp(drawn);
    const entities = pictures(drawn, 10, inherit, lamp);

    drawn.frames(2);
    expect(drawn.frame()).toBe(false);

    setResolution(drawn, 2);

    expect([drawn.frame(), drawn.frame(), drawn.frame(), drawn.frame()]).toEqual([
      true,
      true,
      true,
      false
    ]);

    for (const entity of entities) expectSharp(drawn, entity, 2);
  });

  // Bug: the debt tied to rest: a view that keeps moving stays coarse.
  it("takes a view that moves every frame", async () => {
    const drawn = await open();
    const entities = pictures(drawn, 5);

    setResolution(drawn, 2);

    expect(takesEach(drawn, 2, () => pan(drawn, entities, 1))).toEqual([4, 1]);

    for (const entity of entities) expect(recordOf(drawn, entity).key[KEY.r]).toBe(2);
  });

  // Bug: a stack of alphas read through its stale `r`, or never brought up.
  it("takes a stack drawn direct whole, under the limit", async () => {
    const drawn = await open();
    const entities = pictures(drawn, 5, () => alphaAt("inherit"));

    setResolution(drawn, 2);

    expect(takesEach(drawn, 2)).toEqual([4, 1]);

    for (const entity of entities) expect(recordOf(drawn, entity).key[KEY.rs]).toBe(2);
  });
});

describe("nested pictures on a step up", () => {
  // Bug: every inner refining retakes the outer: taken three times, or churned to live.
  it("takes the outer once, after its inners, and it stays kept", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 5);
    const from = drawn.stage.targets().length;
    const outerLabel = textureLabel(drawn, outer, "#1");

    outerWaited.add(drawn);

    setResolution(drawn, 2);
    drawn.frames(4);

    const taken = renders(drawn, from, "#1");

    expect(taken.filter(label => label === outerLabel)).toHaveLength(1);
    expect(taken.at(-1)).toBe(outerLabel);
    expect(taken).toHaveLength(6);
    expect(recordOf(drawn, outer)).toMatchObject({
      mode: "kept",
      retakeWhy: RETAKE.resolution,
      churn: 0
    });

    for (const entity of inner) expect(recordOf(drawn, entity).key[KEY.r]).toBe(2);
  });

  // Bug: an outer that is not coarser keeps its inner at the old resolution for good.
  it("marks an outer that is not coarser any more", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 9);
    const last = inner.at(-1) as Entity;

    outerWaited.add(drawn);
    setResolution(drawn, 2);
    drawn.frame();
    // Its own change takes the outer at 2 while an inner is still at 1.
    drawn.mock.world.ecs.set(outer, Shape, { w: 510 });
    drawn.frame();

    expect(recordOf(drawn, outer).key[KEY.r]).toBe(2);
    expect(recordOf(drawn, last).key[KEY.r]).toBe(1);

    const from = drawn.stage.targets().length;
    const label = textureLabel(drawn, outer, "#1");

    drawn.frame();

    expect(renders(drawn, from, "#1")).toEqual([textureLabel(drawn, last, "#1"), label]);
    expect(recordOf(drawn, outer)).toMatchObject({ retakeWhy: RETAKE.innerFirst, retakeBy: last });
  });

  // Bug: the outer's stage 3 alone follows, over a stage 1 that still holds the inner at the old resolution.
  it("marks an outer on a fixed resolution that gets stage 3 alone", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 2, fixedAt(1));
    const from = drawn.stage.targets().length;

    setResolution(drawn, 2);
    drawn.frame();

    expect(renders(drawn, from, "#1")).toContain(textureLabel(drawn, outer, "#1"));
    expect(recordOf(drawn, outer)).toMatchObject({
      retakeWhy: RETAKE.innerFirst,
      retakeBy: inner.at(-1)
    });
  });

  // Bug: the outer's stage 3 alone follows: its fixed resolution is the canvas's now, but it was drawn at another one.
  it("marks an outer on a fixed resolution taken below it", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 1, fixedAt(2));
    const from = drawn.stage.targets().length;

    expect(recordOf(drawn, outer).key[KEY.r]).toBe(1);

    setResolution(drawn, 2);
    drawn.frame();

    expect(renders(drawn, from, "#1")).toContain(textureLabel(drawn, outer, "#1"));
    expect(recordOf(drawn, outer).retakeBy).toBe(inner[0]);
  });

  // Bug: three flushes of marks in a row send an outer that is not taken after its inners live and calm.
  it.each([
    ["on a fixed resolution", () => fixedAt(1), inherit, WHOLE_PANEL],
    [
      "on a fixed resolution, over stage-3 refinements",
      () => fixedAt(1),
      () => fixedAt(1),
      WHOLE_PANEL
    ],
    ["cut to the canvas", inherit, inherit, CUT_PANEL]
  ])("a panel %s stays kept over 9 inner refinements", async (_kind, outerSlot, innerSlot, panel) => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 9, outerSlot(), innerSlot, panel);

    expect(recordOf(drawn, outer).cut).toBe(panel === CUT_PANEL);

    setResolution(drawn, 2);
    drawn.frames(4);

    expect(recordOf(drawn, outer)).toMatchObject({
      mode: "kept",
      calm: false,
      retakeWhy: RETAKE.innerFirst
    });
    expect(recordOf(drawn, outer).key[KEY.r]).toBe(2);

    for (const entity of inner) expect(recordOf(drawn, entity).key[KEY.r]).toBe(2);
  });

  // Bug: a change that is not the refining alone reads as one: the outer holds an inner picture that moved on.
  it("marks the outer for a filter value on the refined inner", async () => {
    const drawn = await open();
    const slot = inherit();
    const { outer, inner } = nested(drawn, 1, inherit(), () => slot);

    setResolution(drawn, 2);
    drawn.mock.api.sync.filters.set(inner[0] as Entity, [slot]);
    drawn.frame();

    expect(recordOf(drawn, outer)).toMatchObject({
      retakeWhy: RETAKE.mark,
      retakeBy: inner[0]
    });
  });

  // Bug: `refined` written before the take: the outer stands over a picture that went live.
  it("marks the outer when the refining take fails, and the view draws live", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 1);
    const entity = inner[0] as Entity;

    // A glow found under the top refuses the take (F68).
    recordOf(drawn, entity).blended = true;
    setResolution(drawn, 2);
    drawn.frame();

    expect(recordOf(drawn, entity).mode).toBe("live");
    expect(recordOf(drawn, outer)).toMatchObject({ retakeWhy: RETAKE.mark, retakeBy: entity });
  });

  // Bug: the debt dropped with the failed render, the inner coarse for good; or the render read as a success, which spares
  // the outer: its own mark of that flush would pass as an inner's take. Nothing was drawn, so nothing marks the outer.
  it("keeps the debt of a stage-3 refining that fails and spares nothing above it", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 5, inherit(), () => fixedAt(1));
    const last = inner.at(-1) as Entity;

    outerWaited.add(drawn);
    setResolution(drawn, 2);
    drawn.frame();
    drawn.mock.world.ecs.set(outer, Shape, { w: 510 });
    refused.label = textureLabel(drawn, last, "#3");
    drawn.frame();
    refused.label = undefined;

    expect(recordOf(drawn, last)).toMatchObject({ mode: "kept", coarse: true });
    expect(recordOf(drawn, last).key[KEY.r]).toBe(1);
    expect(recordOf(drawn, outer)).toMatchObject({ retakeWhy: RETAKE.mark, retakeBy: outer });

    const from = drawn.stage.targets().length;

    drawn.frame();

    expect(recordOf(drawn, last)).toMatchObject({ mode: "kept", coarse: false });
    expect(recordOf(drawn, last).key[KEY.r]).toBe(2);
    expect(renders(drawn, from, "#3")[0]).toBe(textureLabel(drawn, last, "#3"));
    expect(renders(drawn, from, "#1")).toContain(textureLabel(drawn, outer, "#1"));
  });

  // Bug: a stack of alphas on a fixed resolution is taken whole, yet read as one that gets stage 3 alone: three takes.
  it("takes an outer stack drawn direct once", async () => {
    const drawn = await open();
    const { outer } = nested(drawn, 5, alphaAt(1));
    const from = drawn.stage.targets().length;
    const label = textureLabel(drawn, outer, "#1");

    outerWaited.add(drawn);
    setResolution(drawn, 2);
    drawn.frames(3);

    expect(renders(drawn, from, "#1").filter(taken => taken === label)).toHaveLength(1);
    expect(recordOf(drawn, outer).retakeWhy).toBe(RETAKE.resolution);
  });

  // Bug: an outer picture left stale: the mark read as one more refining.
  it("a mark under an inner during the refining reaches the coarse outer in that flush", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 5);
    const last = inner.at(-1) as Entity;

    outerWaited.add(drawn);
    second(drawn);
    setResolution(drawn, 2);
    drawn.frame();
    drawn.mock.world.ecs.set(last, Shape, { w: 44 });
    drawn.frame();
    second(drawn);

    const label = drawn.mock.ctx.state.sync.views.get(last)?.object.label;

    expect(whyOf(drawn, outer)).toEqual({ why: "mark", by: label });
    expect(recordOf(drawn, outer).mode).toBe("kept");
  });
});

describe("a stale picture is never a mix of two resolutions", () => {
  // Bug: a change under the view is held back with the step.
  it("a mark takes it at the new resolution", async () => {
    const { drawn, entity } = await stale(inherit());
    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(entity, Shape, { w: 44 });
    drawn.frame();

    expectWhole(drawn, entity, from);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.mark);
  });

  // Bug: a mixed picture: stage 3 at the new `rs` over a stage 1 of the old one.
  it("a filter value takes it whole, not stage 3 alone", async () => {
    const slot = inherit();
    const { drawn, entity } = await stale(slot);
    const from = drawn.stage.targets().length;

    drawn.mock.api.sync.filters.set(entity, [slot]);
    drawn.frame();

    expectWhole(drawn, entity, from);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.filter);
  });

  it("a chain version takes it whole, not stages 2 and 3", async () => {
    const { slot, version } = chainSlot();
    const { drawn, entity } = await stale(slot);
    const from = drawn.stage.targets().length;

    version.value = 2;
    drawn.mock.api.sync.filters.set(entity, [slot]);
    drawn.frame();

    expectWhole(drawn, entity, from);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.chain);
  });

  it("a padding takes it whole", async () => {
    const slot = inherit();
    const { drawn, entity } = await stale(slot);
    const lamp = withLamp(drawn);
    const from = drawn.stage.targets().length;

    slot.filter.padding = 4;
    lamp();

    expectWhole(drawn, entity, from);
    expect(recordOf(drawn, entity).key[KEY.P]).toBe(4);
  });

  // Bug: a mixed stack read as a step: a stage 1 at 1 under a stage 3 at 0.75, or left at 1.5.
  it("a mixed stack crossing its fixed resolution is taken whole", async () => {
    const drawn = await open();

    setResolution(drawn, 1.5);

    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(entity, [inherit(), fixedAt(1)]);
    takeAll(drawn);

    const from = drawn.stage.targets().length;

    setResolution(drawn, 0.75);
    drawn.frame();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity).key[KEY.rs]).toBe(0.75);
    expect(recordOf(drawn, entity).key[KEY.r]).toBe(0.75);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.resolution);
  });

  // Bug: a real change reads through the report as the step, so a tool hunts the wrong thing.
  it("why() on a stale stack names the change, not the step", async () => {
    const slot = inherit();
    const { drawn, entity } = await stale(slot);

    second(drawn);
    drawn.mock.api.sync.filters.set(entity, [slot]);
    drawn.frame();
    second(drawn);

    expect(whyOf(drawn, entity)).toEqual({ why: "filter", by: null });

    setResolution(drawn, 1);
    drawn.frame();
    second(drawn);
    drawn.mock.world.ecs.set(entity, Shape, { w: 44 });
    drawn.frame();
    second(drawn);

    expect(whyOf(drawn, entity)).toMatchObject({ why: "mark" });
  });
});

describe("a stack on a fixed resolution", () => {
  // Bug: stage 3 redone for `r` on the way down, or a filter value taken whole although its stage 1 stands.
  it("is not refreshed by a step down, and a filter value then refreshes stage 3 alone", async () => {
    const drawn = await open();
    const slot = fixedAt(0.5);

    setResolution(drawn, 2);

    const [entity] = pictures(drawn, 1, () => slot);
    const from = drawn.stage.targets().length;

    setResolution(drawn, 1.5);
    drawn.frames(2);

    expect(drawn.stage.targets().length).toBe(from);

    drawn.mock.api.sync.filters.set(entity as Entity, [slot]);
    drawn.frame();

    expect(renders(drawn, from, "#1")).toEqual([]);
    expect(renders(drawn, from, "#3")).toHaveLength(1);
    expect(recordOf(drawn, entity as Entity).key[KEY.r]).toBe(1.5);
    expect(recordOf(drawn, entity as Entity).retakeWhy).toBe(RETAKE.filter);
  });

  // Bug: a stage-3 refining left outside the count: 40 passes in the flush.
  it("is refined by stage 3 alone on a step up, counted under the limit", async () => {
    const drawn = await open();
    const entities = pictures(drawn, 5, () => fixedAt(1));
    const from = drawn.stage.targets().length;

    setResolution(drawn, 2);
    drawn.frame();

    expect(renders(drawn, from, "#3")).toHaveLength(4);

    drawn.frame();

    expect(renders(drawn, from, "#3")).toHaveLength(5);
    expect(renders(drawn, from, "#1")).toEqual([]);

    for (const entity of entities) {
      expect(recordOf(drawn, entity)).toMatchObject({
        coarse: false,
        retakeWhy: RETAKE.resolution
      });
      expect(recordOf(drawn, entity).key[KEY.r]).toBe(2);
    }
  });

  // Bug: a move on the frame of the refining is never noted: the picture rests off its grid for good.
  it("owes a settle for a move on the very frame of its stage-3 refining", async () => {
    const drawn = await open();
    const [entity] = pictures(drawn, 1, () => fixedAt(1));

    setResolution(drawn, 2);
    pan(drawn, [entity as Entity], 0.25);
    drawn.frame();

    expect(recordOf(drawn, entity as Entity)).toMatchObject({ coarse: false, settle: true });

    drawn.frame();

    expectSharp(drawn, entity as Entity, 2);
    expect(recordOf(drawn, entity as Entity).retakeWhy).toBe(RETAKE.settle);
  });
});

describe("a settle owed before a stage-3 refining", () => {
  // Bug: the refining ends the step and nothing asks for the frame: under onDemand the settle waits for a mark.
  it("is taken in a frame asked for", async () => {
    const drawn = await open(true);
    const lamp = withLamp(drawn);

    setResolution(drawn, 1.5);
    lamp();

    const entities = pictures(drawn, 1, () => fixedAt(1), lamp);

    drawn.frames(2);
    setResolution(drawn, 1);
    drawn.frame();
    pan(drawn, entities, 0.25);
    drawn.frames(3);

    expect(recordOf(drawn, entities[0] as Entity).settle).toBe(true);

    setResolution(drawn, 2);
    drawn.frame();

    expect(recordOf(drawn, entities[0] as Entity).coarse).toBe(false);
    expect(drawn.frame()).toBe(true);
    expect(recordOf(drawn, entities[0] as Entity)).toMatchObject({
      retakeWhy: RETAKE.settle,
      settle: false
    });
  });
});

describe("a zoom on the frame of a stage-3 refining", () => {
  // Bug: the refining ends the step before the zoom is noted: under onDemand nothing steps the picture again.
  it("owes its one take at rest", async () => {
    const drawn = await open(true);
    const lamp = withLamp(drawn);
    const entities = pictures(drawn, 5, () => fixedAt(1), lamp);
    const last = entities.at(-1) as Entity;
    const { root } = drawn.mock.ctx.state.sync;

    if (root === undefined) throw new Error("no root");

    drawn.frames(2);
    setResolution(drawn, 2);
    drawn.frame();
    // The fifth is refined in the next flush, the first frame of the zoom.
    root.scale.set(1.1);
    drawn.frame();

    expect(recordOf(drawn, last)).toMatchObject({ coarse: false, settle: true });

    drawn.frames(3);

    expect(recordOf(drawn, last)).toMatchObject({ retakeWhy: RETAKE.settle, settle: false });
    expect(recordOf(drawn, last).key[KEY.a]).toBeCloseTo(1.1);
  });
});

describe("what is not a step", () => {
  // Bug: a real change read as a step.
  it("a filter writing its own resolution is a stage-1 retake", async () => {
    const drawn = await open();
    const slot = inherit();
    const [entity] = pictures(drawn, 1, () => slot);
    const lamp = withLamp(drawn);
    const from = drawn.stage.targets().length;

    slot.filter.resolution = 0.5;
    lamp();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity as Entity).retakeWhy).toBe(RETAKE.resolution);
    expect(recordOf(drawn, entity as Entity).key[KEY.rs]).toBe(0.5);
  });

  // Bug: `"inherit"` in the stack reads as a step: the filter's own change is resampled for good.
  it("a filter writing its own resolution on a stepped picture is a stage-1 retake", async () => {
    const drawn = await open();
    const slot = inherit();

    setResolution(drawn, 2);

    const [entity] = pictures(drawn, 1, () => slot);
    const lamp = withLamp(drawn);

    setResolution(drawn, 1.5);
    drawn.frame();

    const from = drawn.stage.targets().length;

    slot.filter.resolution = 0.5;
    lamp();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity as Entity).retakeWhy).toBe(RETAKE.resolution);
    expect(recordOf(drawn, entity as Entity).key[KEY.rs]).toBe(0.5);
  });

  // Bug: a mixed stack read as a step up: a whole take put under the limit.
  it("a mixed stack stepping up past its fixed resolution is taken whole, without the limit", async () => {
    const drawn = await open();

    setResolution(drawn, 0.75);

    const entities = pictures(drawn, 5, () => [inherit(), fixedAt(1)]);

    setResolution(drawn, 1.5);

    expect(takesEach(drawn, 1)).toEqual([5]);

    for (const entity of entities) {
      expect(recordOf(drawn, entity).key[KEY.rs]).toBe(1);
      expect(recordOf(drawn, entity).key[KEY.r]).toBe(1.5);
    }
  });

  // Bug: the storm is left out for a kind that needs the retake: a cut picture's edge, a placed filter's canvas place.
  it.each([
    ["cut", () => inherit(), { x: -1000, w: 3000 }],
    [
      "placed",
      (): FilterSlot => ({ ...inherit(), cache: "placed", origin: new Float32Array(2) }),
      { x: 100, w: 40 }
    ]
  ])("a %s record is retaken on a step, down too", async (_kind, slot, box) => {
    const drawn = await open();

    setResolution(drawn, 2);

    const entity = drawn.spawn(Transform({ x: box.x, y: 100 }), Shape({ w: box.w, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(entity, [slot()]);
    takeAll(drawn);

    const from = drawn.stage.targets().length;

    setResolution(drawn, 1.5);
    drawn.frame();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity).key[KEY.r]).toBe(1.5);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.resolution);
  });
});

describe("a stack drawn direct", () => {
  // Bug: the step read through `KEY.r`, stale on a direct record: a whole take of every alpha.
  it.each([
    ["on inherit", "inherit", 2, 1.5],
    ["on a resolution of its own", 1, 1, 0.5]
  ] as const)("%s: a step down neither takes nor refreshes", async (_kind, own, from, to) => {
    const drawn = await open();

    setResolution(drawn, from);

    const [entity] = pictures(drawn, 1, () => alphaAt(own));
    const log = drawn.stage.targets().length;

    expect(recordOf(drawn, entity as Entity).direct).toBe(true);

    setResolution(drawn, to);
    drawn.frames(3);

    expect(drawn.stage.targets().length).toBe(log);
    expect(recordOf(drawn, entity as Entity).direct).toBe(true);
  });
});

describe("settle retakes share the limit", () => {
  // Bug: the limit lost, or a held settle never asked for: the last pictures stay off their grid until a mark.
  it("40 pictures that stop off their grid take at most 4 a flush, finished without a mark", async () => {
    const drawn = await open(true);
    const lamp = withLamp(drawn);
    const entities = pictures(drawn, 40, inherit, lamp);

    pan(drawn, entities, 0.25);
    drawn.frame();

    const takes: number[] = [];

    for (let frame = 0; frame < 12 && drawn.frame(); frame += 1) {
      takes.push(keptOf(drawn).frameTakes);
    }

    expect(takes).toEqual(Array.from({ length: 10 }, () => 4));

    for (const entity of entities) {
      expectSharp(drawn, entity, 1);
      expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.settle);
    }
  });

  // Bug: the outer churned to live by a settle spread over three flushes.
  it("a nested outer over 9 inner settle takes spread over frames stays kept", async () => {
    const drawn = await open();
    const { outer, inner } = nested(drawn, 9);

    pan(drawn, inner, 0.25);
    drawn.frame();

    expect(takesEachInner(drawn, inner)).toEqual([4, 4, 1, 0]);
    expect(recordOf(drawn, outer)).toMatchObject({ mode: "kept", retakeWhy: RETAKE.innerFirst });
  });

  // Bug: the storm back at rest: a pan across the step retakes every picture when it stops.
  it("a pan across a step up that then rests takes at most 4 a flush", async () => {
    const drawn = await open();
    const entities = pictures(drawn, 40);

    const moving = takesEach(drawn, 3, frame => {
      if (frame === 1) setResolution(drawn, 2);
      pan(drawn, entities, 0.25);
    });
    const resting = takesEach(drawn, 22);

    expect(Math.max(...moving, ...resting)).toBe(4);

    for (const entity of entities) expectSharp(drawn, entity, 2);
  });

  // Bug: the move read on the canvas's grid: half a pixel is a whole texel of a picture at 2, not of a canvas at 1.5.
  it("a move on the picture's own grid at a lowered resolution owes no settle", async () => {
    const drawn = await open();

    setResolution(drawn, 2);

    const entities = pictures(drawn, 1);
    const from = drawn.stage.targets().length;

    setResolution(drawn, 1.5);
    drawn.frame();
    pan(drawn, entities, 0.5);
    drawn.frame();

    expect(recordOf(drawn, entities[0] as Entity).settle).toBe(false);

    setResolution(drawn, 2);
    drawn.frames(3);

    expect(drawn.stage.targets().length).toBe(from);
  });

  it("a pan across a step down that then rests takes nothing while the step holds", async () => {
    const drawn = await open();

    setResolution(drawn, 2);

    const entities = pictures(drawn, 40);

    const takes = takesEach(drawn, 8, frame => {
      if (frame === 1) setResolution(drawn, 1.5);
      if (frame < 3) pan(drawn, entities, 0.25);
    });

    expect(Math.max(...takes)).toBe(0);
    // The settle stands, for the end of the step.
    expect(entities.every(entity => recordOf(drawn, entity).settle)).toBe(true);
  });

  // Bug: the storm on the way back, or a debt lost.
  it.each([
    ["on inherit, a step back", inherit, 2, 1.5, 2],
    ["on a fixed resolution, a step back", () => fixedAt(1), 2, 1.5, 2],
    ["on a fixed resolution, a step up past its drawn one", () => fixedAt(1), 1.5, 1, 2]
  ])("a pan at a lowered resolution, %s: at most 4 a flush, all on their grid", async (_kind, slot, taken, lowered, last) => {
    const drawn = await open();

    setResolution(drawn, taken);

    const entities = pictures(drawn, 40, slot);

    setResolution(drawn, lowered);
    drawn.frame();
    pan(drawn, entities, 0.25);
    drawn.frames(3);

    setResolution(drawn, last);

    const takes = takesEach(drawn, 30);

    expect(Math.max(...takes)).toBe(4);

    for (const entity of entities) expectSharp(drawn, entity, last);
  });

  // Bug: `coarse` and `settle` both firing in a flush: eight takes.
  it("a pan that crosses the step and rests while the debts are paid takes at most 4 a flush", async () => {
    const drawn = await open();
    const entities = pictures(drawn, 40);

    setResolution(drawn, 2);
    drawn.frames(2);
    setResolution(drawn, 1.5);

    const moving = takesEach(drawn, 2, () => pan(drawn, entities, 0.125));

    setResolution(drawn, 2);

    const resting = takesEach(drawn, 24);

    expect(Math.max(...moving, ...resting)).toBeLessThanOrEqual(4);

    for (const entity of entities) expectSharp(drawn, entity, 2);
  });
});

describe("a zoom over a stepped picture", () => {
  // Bug: a stale resolution makes a zoom a retake every frame: the picture is not scalable.
  it("draws it scaled, and past the limit it is taken with scale-limit", async () => {
    const { drawn, entity, root, lamp } = await steppedUnderRoot();
    const from = drawn.stage.targets().length;

    root.scale.set(1.2);
    lamp();

    expect(drawn.stage.targets().length).toBe(from);

    root.scale.set(3);
    lamp();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.scaleLimit);
  });

  // Bug: a settle waiting for the end of the step drops the zoom's one take at rest.
  it("that ends across a step owes its one take at rest", async () => {
    const { drawn, entity, root, lamp } = await steppedUnderRoot();
    const from = drawn.stage.targets().length;

    root.scale.set(1.2);
    lamp();
    lamp();

    expect(renders(drawn, from, "#1")).toHaveLength(1);
    expect(recordOf(drawn, entity).retakeWhy).toBe(RETAKE.settle);
    expect(recordOf(drawn, entity).key[KEY.a]).toBeCloseTo(1.2);
    expect(recordOf(drawn, entity).key[KEY.r]).toBe(1.5);
  });
});

describe("the quad after a step", () => {
  // Bug: the quad jumps with the step: a place read through the new grid.
  it("stands where it stood, also for a view moved since its take", async () => {
    const drawn = await open();

    setResolution(drawn, 2);

    const [still, moved] = pictures(drawn, 2);

    pan(drawn, [moved as Entity], 5);
    drawn.frames(2);

    const place = (entity: Entity): Float64Array =>
      recordOf(drawn, entity).key.slice(KEY.qa, KEY.qty + 1);
    const before = [place(still as Entity), place(moved as Entity)];
    const quads = [still as Entity, moved as Entity].map(entity => recordOf(drawn, entity).quad);
    const written = quads.map(quad => vi.spyOn(quad as pixi.Sprite, "setFromMatrix"));

    setResolution(drawn, 1.5);
    drawn.frames(2);

    expect([place(still as Entity), place(moved as Entity)]).toEqual(before);

    for (const spy of written) expect(spy).not.toHaveBeenCalled();
  });
});

describe("the pixel oracle after a step", () => {
  // Bug: the resampling of a picture nothing changed reads as stale, and every view is dropped to live.
  it("skips and counts a frame with a picture of another resolution, and logs nothing", async () => {
    const drawn = await differing();

    setResolution(drawn, 2);

    const [entity] = pictures(drawn, 1);
    const skipped = keptOf(drawn).verifySkipped;

    setResolution(drawn, 1.5);
    drawn.frame();
    drawn.mock.api.sync.debug.verifyFrames(true);
    drawn.frames(2);

    expect(keptOf(drawn).verifySkipped - skipped).toBe(2);
    expect(staleLines(drawn)).toBe(0);
    expect(recordOf(drawn, entity as Entity).mode).toBe("kept");
  });

  // Bug: the skip stays on when the picture matches the canvas: a stale picture is never reported.
  it("compares the frame again once the picture is drawn at the canvas resolution", async () => {
    const drawn = await differing();

    setResolution(drawn, 2);
    pictures(drawn, 1);
    drawn.mock.api.sync.debug.verifyFrames(true);
    drawn.frame();

    expect(staleLines(drawn)).toBe(1);
  });
});
