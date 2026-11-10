import * as pixiJs from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Parent, Transform } from "../../../renderer/components";
import { type FrameOracle, watchFrames } from "../../../renderer/__tests__/stage-oracle";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import type { Entity } from "../../../world/types";
import {
  afterEachFrame,
  type DrawnApp,
  type DrawnPixi,
  pointer,
  settle,
  startDrawnApp,
  step,
  stripSettled
} from "../drawn-app";

// ---------------------------------------------------------------------------
// A `Draggable` on a child element of a JSX projection, as A Memory Missing's night strip carries
// `stripHeld`. F165: the drag took its `Parent` and it had no `Layer`, so it was drawn nowhere and
// the renderer's tree went wrong. F166: `projection.settle` knew only world views, so a dropped
// element that no target took stayed where the finger let go.
// ---------------------------------------------------------------------------

/** The apps a test started, with the oracle that watched them. */
const running: Array<{ stop(): Promise<void>; oracle: FrameOracle }> = [];

afterEach(async () => {
  for (const { stop, oracle } of running.splice(0)) {
    oracle.expectNoMissedFrame();
    await stop();
  }

  stripSettled.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The label of the root container of `sync`. */
const ROOT_LABEL = "renderer.root";

/** A display object as far as this test reads it. */
type Shown = { label: string; parent: Shown | null };

/**
 * Whether a view is drawn: its display object has a path up to the root of `sync`.
 *
 * @param app - The running app.
 * @param entity - The view.
 * @returns True when it is drawn.
 */
function isDrawn(app: DrawnApp, entity: Entity): boolean {
  let node = app.renderer.sync.displayOf(entity) as Shown | null | undefined;

  while (node !== null && node !== undefined) {
    if (node.label === ROOT_LABEL) return true;
    node = node.parent;
  }

  return false;
}

/**
 * Starts the drawn app on the real Pixi with the tree oracle, mounts the strip and notes every
 * renderer warning by its event.
 *
 * @returns The app, its Pixi and the warnings seen.
 */
async function startStrip(): Promise<{ app: DrawnApp; pixi: DrawnPixi; warned: string[] }> {
  const warned: string[] = [];
  const warn = console.warn;

  vi.spyOn(console, "warn").mockImplementation((entry: { event?: string }, ...rest: unknown[]) => {
    if (typeof entry === "object" && entry !== null && typeof entry.event === "string") {
      warned.push(entry.event);
    } else {
      warn(entry, ...rest);
    }
  });

  const stage = stagePixi();
  const texture = new pixiJs.Texture({
    source: new pixiJs.TextureSource({ width: 64, height: 64 })
  });
  const drawn = await startDrawnApp({ stage, texture: () => texture });
  const oracle = watchFrames(stage.last(), pixiJs);

  afterEachFrame(drawn.app, () => oracle.check());
  running.push({ stop: () => drawn.app.stop(), oracle });
  drawn.app.world.projection.mount(["drawn.strip"], { kind: "plugin", name: "test" });
  await settle(drawn.app, 3);

  return { app: drawn.app, pixi: drawn.pixi, warned };
}

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: DrawnApp, key: string): Entity {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}"`);

  return entity;
}

/**
 * Picks an element up at its centre and moves it 300 u right and 200 u up in four frames, the
 * finger still down. Every frame of the carry is checked: the element is drawn.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi.
 * @param entity - The element.
 * @param from - The centre of the element.
 * @returns The frames in which the element was not drawn.
 */
function carry(
  app: DrawnApp,
  pixi: DrawnPixi,
  entity: Entity,
  from: { x: number; y: number }
): number[] {
  const undrawn: number[] = [];

  pointer(app, pixi, "pointerdown", from);
  step(app);

  for (let move = 1; move <= 4; move += 1) {
    pointer(app, pixi, "pointermove", { x: from.x + 75 * move, y: from.y - 50 * move });
    step(app);
    if (!isDrawn(app, entity)) undrawn.push(move);
  }

  return undrawn;
}

/**
 * Lets the finger go where `carry` left it and runs the frames of the way home.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi.
 * @param from - The centre the carry started at.
 * @param frames - How many frames to step after the release.
 */
async function letGo(
  app: DrawnApp,
  pixi: DrawnPixi,
  from: { x: number; y: number },
  frames: number
): Promise<void> {
  pointer(app, pixi, "pointerup", { x: from.x + 300, y: from.y - 200 });
  step(app);
  await settle(app, frames);
}

describe("a Draggable child of a JSX projection", () => {
  // Bug (F165): the grab took the child's `Parent`; with no `Layer` of its own it was not drawn
  // ("renderer: entity is not drawn, unknown layer"), and its wrapper stayed in the old parent.
  it("is drawn in its root's layer for the whole carry and hangs under its parent again at the release", async () => {
    const { app, pixi, warned } = await startStrip();
    const held = entityOf(app, "stripHeld");
    const root = entityOf(app, "stripRoot");

    const undrawn = carry(app, pixi, held, { x: 200, y: 1100 });

    expect(undrawn).toEqual([]);
    expect(app.world.ecs.has(held, Parent)).toBe(false);
    expect(app.world.ecs.get(held, Layer)?.name).toBe(app.world.ecs.get(root, Layer)?.name);

    await letGo(app, pixi, { x: 200, y: 1100 }, 2);

    expect(app.world.ecs.get(held, Parent)?.entity).toBe(root);
    expect(app.world.ecs.has(held, Layer)).toBe(false);
    expect(isDrawn(app, held)).toBe(true);
    expect(warned).not.toContain("renderer: entity is not drawn, unknown layer");
    expect(warned).not.toContain("renderer:tree-mismatch");
  });

  // Bug (F166): `projection.settle` looked only at world views, so the release left a ui element
  // at the finger pose (the game's `stripHeld` at 197,372 instead of 218,778 for 600 ms and more).
  it("dropped where no target takes it, glides home to its layout rest", async () => {
    const { app, pixi } = await startStrip();
    const held = entityOf(app, "stripHeld");
    const rest = app.world.projection.restOf(held, Transform);

    carry(app, pixi, held, { x: 200, y: 1100 });
    await letGo(app, pixi, { x: 200, y: 1100 }, 2);

    // Under way: off the finger pose, not home yet.
    const moving = app.world.ecs.get(held, Transform);

    expect(moving?.x).not.toBe(rest?.x);

    await settle(app, 40);

    expect(app.world.ecs.get(held, Transform)).toMatchObject({ x: rest?.x, y: rest?.y });
  });

  it("dropped, plays its own settle hook with the components that stand off their rest", async () => {
    const { app, pixi } = await startStrip();
    const hooked = entityOf(app, "stripHooked");
    const rest = app.world.projection.restOf(hooked, Transform);

    carry(app, pixi, hooked, { x: 700, y: 1100 });

    expect(stripSettled).toEqual([]);

    await letGo(app, pixi, { x: 700, y: 1100 }, 12);

    expect(stripSettled).toEqual([["Transform"]]);
    expect(app.world.ecs.get(hooked, Transform)).toMatchObject({ x: rest?.x, y: rest?.y });
  });
});
