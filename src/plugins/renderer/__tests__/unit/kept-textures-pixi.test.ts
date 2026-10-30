import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import type { PixiRenderTexture } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// The render targets of kept pictures against the bind groups Pixi keeps. Pixi
// 8.22 caches the bind group of every batch and every filter input it drew, and
// each listens to `change` on the source and on its style: destroying a target
// it holds warns "[BindGroup] a 'textureSource' was destroyed while still bound
// to a shader" (A26 build B: about 500 per board entry). The headless stage
// draws no batches, so each test makes the bind groups a drawn frame makes.
// ---------------------------------------------------------------------------

/** The texture slots of a batch bind group on a common device. */
const SLOTS = 16;

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Starts the renderer, every frame drawn, and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false });

  running.push(drawn);

  return drawn;
}

/**
 * Spawns a 40 x 40 shape with a kept filter and runs the three frames of its take.
 *
 * @param drawn - The running renderer.
 * @returns The entity.
 */
function keep(drawn: Drawn): Entity {
  const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [
    { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
  ]);
  drawn.frames(3);

  return entity;
}

/**
 * The render targets of an entity's picture, after Pixi drew them: a batch bind group over each, as the quad's
 * batch and the filter's input leave behind.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity, kept.
 * @returns The targets.
 */
function drawnTargets(drawn: Drawn, entity: Entity): PixiRenderTexture[] {
  const record = drawn.mock.ctx.state.kept.byEntity.get(entity);
  const targets = [record?.s1, record?.s3].filter(texture => texture !== undefined);

  if (targets.length === 0) throw new Error(`no picture for ${entity}`);

  for (const target of targets) pixi.getTextureBatchBindGroup([target.source], 1, SLOTS);

  return targets;
}

/**
 * Catches the console, where Pixi writes its warnings.
 *
 * @returns The spy.
 */
function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * Counts the `[BindGroup]` warnings Pixi wrote.
 *
 * @param spy - The spy on `console.warn`.
 * @returns How many calls carried one.
 */
function bindGroupWarnings(spy: MockInstance<typeof console.warn>): number {
  return spy.mock.calls.filter(call => call.some(part => String(part).includes("[BindGroup]")))
    .length;
}

describe("a kept picture's render targets that Pixi drew", () => {
  // Bug: the targets of a view that left are destroyed, from the pool (F119), while Pixi's cached bind groups still
  // listen: a warning per source and per style, every time the pool empties.
  it("go without a bind group warning when the view leaves and the pool empties", async () => {
    const drawn = await open();
    const entity = keep(drawn);
    const targets = drawnTargets(drawn, entity);
    const spy = quiet();

    drawn.mock.world.ecs.despawn(entity);
    drawn.frame();

    // The view's targets wait in the pool for the next take of their size.
    expect(targets.every(target => drawn.mock.ctx.state.kept.pool.includes(target))).toBe(true);

    drawn.mock.modules.kept.reset();

    expect(targets.every(target => target.destroyed)).toBe(true);
    expect(bindGroupWarnings(spy)).toBe(0);
  });

  // Bug: the renderer's stop destroys every target the same way: a warning per picture at teardown.
  it("go without a bind group warning when the renderer stops", async () => {
    const drawn = await open();
    const targets = drawnTargets(drawn, keep(drawn));
    const spy = quiet();

    running.splice(0);
    drawn.mock.stop();

    expect(targets.every(target => target.destroyed)).toBe(true);
    expect(bindGroupWarnings(spy)).toBe(0);
  });
});
