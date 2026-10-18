/**
 * @file renderer — the fixtures of the perf files: an agent build whose page clock is a plain function, a steady frame
 * record, and a started renderer with a layer of sprite views. Not a test file. Every fixture is built outside the
 * measured window; what a window calls allocates only what the engine allocates.
 */
import { vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import type { FrameMeasure } from "../../../time/types";
import { Layer } from "../../../world/ecs/define";
import type { Entity, SystemTiming } from "../../../world/types";
import {
  HudPart,
  Sprite,
  type SpriteValue,
  Transform,
  type TransformValue
} from "../../components";
import { commitFrame } from "../../monitor/commit";
import type { PixiFilter } from "../../types";
import { FakeFilter, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { type AgentRenderer, startAgent } from "../perf-harness";

/** The owner of every entity the fixtures spawn. */
const OWNER = { kind: "plugin", name: "perf" } as const;

/** The page clock between two frames at 120 Hz, ms. */
export const FRAME_MS = 8.33;

/** Calls before a window: the engine's code reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/**
 * Calls of a window, ten times `alloc`'s default: a stray compile of a few kilobytes inside it weighs a tenth of a byte
 * a call, so the two halves of `alloc`'s cross-check still agree on a step that keeps 0 B.
 */
const CALLS = 100_000;

/**
 * The heap bytes one call of a step keeps: the step run until V8 optimized what it calls, outside the window, then
 * `alloc` over a window of `CALLS`.
 *
 * @param fn - The step.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * Starts an agent build whose page clock is a plain function that moves on by 1 ms at every read: the harness's spy
 * records every call, which a window would count, and Node's own clock allocates at every read. Whole milliseconds are
 * small integers, which a call hands back unboxed, so a window counts the engine's bytes alone (a browser's clock may
 * box its answer: that is the platform's). A bench keeps the real clock instead: it times its runs with it. Thirty
 * world systems are timed, as on the ward of A Memory Missing.
 *
 * @param clock - `"plain"` for an alloc window, `"real"` for a bench.
 * @returns The started agent build.
 */
export async function startPlainAgent(clock: "plain" | "real" = "plain"): Promise<AgentRenderer> {
  const agent = await startAgent({ scene: { passes: 2, batches: 2, draws: 1 } });
  const page = agent.clock;

  vi.restoreAllMocks();
  if (clock === "plain") {
    globalThis.performance.now = (): number => {
      page.now += 1;

      return page.now;
    };
  }
  agent.mock.setSystemTimes(systemTiming(30));

  return agent;
}

/**
 * A timing table of `count` systems, each with a few hundredths of a millisecond.
 *
 * @param count - The systems.
 * @returns The table.
 */
function systemTiming(count: number): SystemTiming {
  return {
    clock: () => 0,
    names: Array.from({ length: count }, (_name, index) => `system.${index}`),
    ms: Float64Array.from({ length: count }, (_ms, index) => 0.01 + (index % 7) * 0.013)
  };
}

/**
 * One reused frame record of a steady 120 Hz frame, as `time` hands its listeners: the caller moves `frame` on. The
 * page clock is held inside one second, so no flush runs in a window.
 *
 * @param gapMs - The gap since the last frame: 8.3 for a steady frame, 30 for a late one.
 * @returns The record.
 */
export function steadyFrame(gapMs = 8.3): FrameMeasure {
  return {
    frame: 1,
    at: 500.5,
    gapMs,
    capMs: FRAME_MS,
    rateMs: FRAME_MS,
    displayMs: FRAME_MS,
    skipped: 0,
    startMs: 0.1,
    phaseMs: Float32Array.of(0.2, 0.1, 0.1, 0.4, 0.1, 1),
    workMs: 2.5,
    listenersMs: 0.05,
    idle: false,
    stepped: false
  };
}

/**
 * One frame of the monitor of an agent build, as the frame drives it: the window opens at the frame's start on the
 * `clock` the counters read, the frame ends drawn after its work, the record is committed and its frame number moves
 * on. The clock moves 8.33 ms a frame, so the window's times are fractions, as on a phone.
 *
 * @param agent - The started agent build.
 * @param record - The frame record.
 */
export function monitorFrame(agent: AgentRenderer, record: FrameMeasure): void {
  const { mock, pc } = agent;

  mock.setNow(record.frame * FRAME_MS);
  mock.modules.monitor.begin();
  mock.setNow(record.frame * FRAME_MS + record.workMs);
  mock.modules.monitor.end(true);
  commitFrame(pc, record);
  record.frame += 1;
}

/** A started renderer with `count` sprite views in one layer, every change set cleared. */
export type SpriteStage = {
  mock: MockRenderer;
  entities: Entity[];
};

/**
 * Starts the mock renderer (no agent flag: a release build's pass) with `count` sprites of a 64 x 64 texture in the
 * layer `items`, each 64 x 64 at its own place, and runs the pass that builds them.
 *
 * @param count - The sprites.
 * @param onDemand - `renderer.onDemand`: a frame is drawn only for a reason.
 * @returns The stage.
 */
export async function startSprites(count: number, onDemand = false): Promise<SpriteStage> {
  const mock = createMockRenderer({ config: { onDemand } });
  const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entities: Entity[] = [];

  for (let index = 0; index < count; index += 1) {
    entities.push(
      mock.world.ecs.spawn(OWNER, [
        Layer({ name: "items" }),
        Transform({ x: (index % 20) * 50, y: Math.floor(index / 20) * 50 }),
        Sprite({ texture: "board.cell", width: 64, height: 64 })
      ])
    );
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return { mock, entities };
}

/**
 * The stored `Transform` of an entity, writable: a window moves it in place, so the world's own `set` (its change
 * marks) stays out of the bytes the renderer is measured by. The entity's change mark is made once, by the caller.
 *
 * @param mock - The started renderer.
 * @param entity - The entity.
 * @returns The value the world holds.
 */
export function storedTransform(mock: MockRenderer, entity: Entity): TransformValue {
  const value = mock.world.ecs.get(entity, Transform);

  if (value === undefined) throw new Error("perf fixture: the entity has no Transform");

  return value as TransformValue;
}

/**
 * The stored `Sprite` of an entity, writable, as `storedTransform`.
 *
 * @param mock - The started renderer.
 * @param entity - The entity.
 * @returns The value the world holds.
 */
export function storedSprite(mock: MockRenderer, entity: Entity): SpriteValue {
  const value = mock.world.ecs.get(entity, Sprite);

  if (value === undefined) throw new Error("perf fixture: the entity has no Sprite");

  return value as SpriteValue;
}

/**
 * One frame of change marks: `count` views of a 20-sprite stage marked (every other one a move, the rest what it
 * draws), then the render phase's decision, which empties the marks.
 *
 * @param count - The views marked a frame, at most 20.
 * @param onDemand - `renderer.onDemand`: each mark is judged for the decision.
 * @returns The step.
 */
export async function markedFrame(count: number, onDemand: boolean): Promise<() => void> {
  const { mock, entities } = await startSprites(20, onDemand);
  const { demand } = mock.modules;
  const moves = entities.slice(0, count).filter((_entity, index) => index % 2 === 0);
  const looks = entities.slice(0, count).filter((_entity, index) => index % 2 === 1);

  return () => {
    for (const entity of moves) demand.markMoved(entity);
    for (const entity of looks) demand.mark(entity);

    demand.decide(false);
  };
}

/**
 * A still stage of 12 filtered sprites among 40, as the ward of A Memory Missing: each carries one filter of one apply,
 * hung through the seam `effects` uses. The pass that builds them has run, every change set is cleared.
 *
 * @returns The started renderer.
 */
export async function filteredStage(): Promise<MockRenderer> {
  const { mock, entities } = await startSprites(40);

  for (let index = 0; index < 12; index += 1) {
    const entity = entities[index * 3] ?? 0;
    const filter = new FakeFilter() as unknown as PixiFilter;

    mock.api.sync.filters.set(entity, [{ filter, passes: 1, kind: "fog" }]);
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return mock;
}

/**
 * A still stage with a HUD: the layers `scene` and `hud` (above the overlays), 20 sprites in the scene and 5 HUD parts
 * in the HUD layer, no overlay open. The pass that builds them has run, every change set is cleared.
 *
 * @returns The started renderer.
 */
export async function hudStage(): Promise<MockRenderer> {
  const mock = createMockRenderer();
  const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers([
    { name: "scene", sort: "none" },
    { name: "hud", sort: "none", above: "overlays" }
  ]);

  for (let index = 0; index < 20; index += 1) {
    mock.world.ecs.spawn(OWNER, [
      Layer({ name: "scene" }),
      Transform({ x: index * 50 }),
      Sprite({ texture: "board.cell" })
    ]);
  }

  for (let index = 0; index < 5; index += 1) {
    mock.world.ecs.spawn(OWNER, [
      Layer({ name: "hud" }),
      Transform({ x: index * 100 }),
      Sprite({ texture: "board.cell" }),
      HudPart({ key: `part${index}` })
    ]);
  }

  mock.modules.sync.pass();
  mock.modules.sync.stepOverlays();
  mock.world.clearChanges();

  return mock;
}
