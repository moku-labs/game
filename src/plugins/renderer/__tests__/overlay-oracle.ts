/**
 * @file The atomicity checker of the overlay tests (spec 22 K3). Not a test. After every frame it reads, from public
 * Pixi state, the renders the stand-in logged and `debug.overlays()`:
 *
 * - every leaf the last drawn frame drew live and this drawn frame hides by `renderable` (still in the tree, visible,
 *   not transparent) is drawn by a range picture shown now, which rendered it, or lies under an opaque cover;
 * - an overlay reported in mode `"freeze"` has its range picture shown in the frame;
 * - every HUD part of the HUD layer is drawn with the factor the overlays' levels of the same frame give it.
 *
 * It imports nothing of the overlay step, so a hole in the step is not repeated here. `expectAtomic()` fails naming
 * the first frame and view.
 */
import type * as Pixi from "pixi.js";
import { expect } from "vitest";
import { Layer } from "../../world/ecs/define";
import type { EcsApi, Entity } from "../../world/types";
import { HudPart, NineSlice, Overlay, Parent, Shape, Sprite } from "../components";
import type { OverlayReport } from "../sync/types";
import type { RenderCall, StageApplication } from "./stage-pixi";

/** What the checker watches: the stand-in application, the overlays' reports and the world the parts live in. */
export type OverlayTarget = {
  stage: StageApplication;
  overlays(): readonly OverlayReport[];
  ecs: Pick<EcsApi, "get" | "query">;
  displayOf(entity: Entity): unknown;
  /** The scene's HUD layer: only its parts are faded. */
  hudLayer: string;
};

/** One frame that broke K3: the frame and what was wrong. */
export type AtomicBreak = { frame: number; what: string };

/** What a test drives the checker with. */
export type OverlayOracle = {
  /** Reads the frame that just ran. */
  check(): void;
  readonly breaks: AtomicBreak[];
  /** Fails the test at the first frame that broke K3. */
  expectAtomic(): void;
};

/** A HUD factor equal within this much. */
const FACTOR_TOLERANCE = 1e-6;

/** The real Pixi classes the checker tells nodes apart by: the picture sprites, and what draws (a view container). */
type PixiClasses = Pick<typeof Pixi, "Sprite" | "ViewContainer">;

/**
 * Tells whether a node is drawn by the stage pass: it and everything up to the stage visible, renderable and not
 * transparent.
 *
 * @param node - The node.
 * @param stage - The stage.
 * @returns True when the stage pass draws it.
 */
function drawnLive(node: Pixi.Container, stage: Pixi.Container): boolean {
  for (let current: Pixi.Container | null = node; current !== null; current = current.parent) {
    if (!current.visible || !current.renderable || current.alpha <= 0) return false;
    if (current === stage) return true;
  }

  return false;
}

/**
 * Tells whether a node hangs under the stage, visible and not transparent all the way: it would be drawn if nothing
 * hid it by `renderable`.
 *
 * @param node - The node.
 * @param stage - The stage.
 * @returns True when only `renderable` keeps it from the stage pass.
 */
function shownButHidden(node: Pixi.Container, stage: Pixi.Container): boolean {
  if (node.destroyed) return false;

  let hidden = false;

  for (let current: Pixi.Container | null = node; current !== null; current = current.parent) {
    if (!current.visible || current.alpha <= 0) return false;
    if (!current.renderable) hidden = true;
    if (current === stage) return hidden;
  }

  return false;
}

/**
 * The nodes under a node that draw something (view containers: sprites, graphics, texts), in tree order.
 *
 * @param node - The node.
 * @param pixi - The Pixi classes.
 * @param into - Where they go.
 * @returns The same set.
 */
function leavesOf(
  node: Pixi.Container,
  pixi: PixiClasses,
  into: Set<Pixi.Container>
): Set<Pixi.Container> {
  if (node instanceof pixi.ViewContainer) into.add(node);

  for (const child of node.children) leavesOf(child, pixi, into);

  return into;
}

/**
 * The drawing nodes a render of a container drew: its children by their own flags, as Pixi collects them.
 *
 * @param node - The node walked.
 * @param root - The container rendered.
 * @param pixi - The Pixi classes.
 * @param into - Where the drawn nodes go.
 */
function drawnLeaves(
  node: Pixi.Container,
  root: Pixi.Container,
  pixi: PixiClasses,
  into: Set<object>
): void {
  if (node !== root && (!node.visible || !node.renderable || node.alpha <= 0)) return;
  if (node instanceof pixi.ViewContainer) into.add(node);

  for (const child of node.children) drawnLeaves(child, root, pixi, into);
}

/**
 * Whether an overlay's `hud` keeps a part shown.
 *
 * @param hud - The overlay's `hud`.
 * @param key - The part's key.
 * @returns 1 or 0.
 */
function keepsOf(hud: "all" | "none" | readonly string[], key: string): number {
  if (hud === "all") return 1;
  if (hud === "none") return 0;

  return hud.includes(key) ? 1 : 0;
}

/**
 * The factor a HUD part should be drawn with, from the overlays' levels of the frame, bottom first.
 *
 * @param target - The watched app.
 * @param key - The part's key.
 * @returns The factor.
 */
function expectedFactor(target: OverlayTarget, key: string): number {
  let factor = 1;

  for (const report of target.overlays()) {
    factor +=
      (keepsOf(target.ecs.get(report.entity, Overlay)?.hud ?? "all", key) - factor) * report.level;
  }

  return factor;
}

/**
 * The layer a part is drawn in: the `Layer` of the root of its `Parent` chain.
 *
 * @param ecs - The world.
 * @param entity - The part.
 * @returns The layer name.
 */
function layerOfRoot(ecs: OverlayTarget["ecs"], entity: Entity): string | undefined {
  let current = entity;

  for (let depth = 0; depth < 32; depth += 1) {
    const parent = ecs.get(current, Parent)?.entity ?? 0;

    if (parent === 0 || parent === current) break;

    current = parent;
  }

  return ecs.get(current, Layer)?.name;
}

/**
 * Watches a running renderer for K3.
 *
 * @param target - The watched app.
 * @param pixi - The real Pixi module, for its classes.
 * @returns The checker.
 */
export function watchOverlays(target: OverlayTarget, pixi: PixiClasses): OverlayOracle {
  const { stage } = target;
  const breaks: AtomicBreak[] = [];
  /** Texture of a range picture → the leaves its last render drew. */
  const ranges = new WeakMap<object, Set<object>>();
  /** Every container a picture (a kept view's) was rendered from. */
  const pictured = new WeakSet<object>();
  let lastRenders = stage.renderer.renders;
  let liveBefore = new Set<Pixi.Container>();
  let frame = 0;

  stage.renderer.watchers.push((call: RenderCall) => {
    if (call.target === undefined) return;

    pictured.add(call.container);

    if (call.container.label !== "renderer.root") return;

    const leaves = new Set<object>();

    drawnLeaves(call.container, call.container, pixi, leaves);
    ranges.set(call.target, leaves);
  });

  /**
   * The leaves the range pictures shown now drew.
   *
   * @returns The union of their leaves, and how many are shown.
   */
  const shownPictures = (): { leaves: Set<object>; count: number } => {
    const leaves = new Set<object>();
    let count = 0;

    for (const node of leavesOf(stage.stage, pixi, new Set())) {
      if (!(node instanceof pixi.Sprite) || !drawnLive(node, stage.stage)) continue;

      const drawn = ranges.get(node.texture);

      if (drawn === undefined) continue;

      count += 1;
      for (const leaf of drawn) leaves.add(leaf);
    }

    return { leaves, count };
  };

  /**
   * Tells whether a node lies under a container a kept view's picture was rendered from.
   *
   * @param node - The node.
   * @returns True when a kept picture stands for it.
   */
  const underPictured = (node: Pixi.Container): boolean => {
    for (let current: Pixi.Container | null = node; current !== null; current = current.parent) {
      if (pictured.has(current) && current.label !== "renderer.root") return true;
    }

    return false;
  };

  /**
   * Checks the HUD parts of the HUD layer against the levels of the frame.
   */
  const checkParts = (): void => {
    for (const [entity, part] of target.ecs.query(HudPart)) {
      if (layerOfRoot(target.ecs, entity) !== target.hudLayer) continue;

      const object = target.displayOf(entity) as Pixi.Container | undefined;

      if (object === undefined) continue;

      const factor = expectedFactor(target, part.key);
      const wrapper = object.parent?.label === `parent#${entity}` ? object.parent : undefined;
      const own =
        target.ecs.get(entity, Shape)?.alpha ??
        target.ecs.get(entity, Sprite)?.alpha ??
        target.ecs.get(entity, NineSlice)?.alpha;
      const drawn = own === undefined ? (wrapper?.alpha ?? 1) : (wrapper ?? object).alpha / own;

      if (own === 0) continue;

      if (Math.abs(drawn - factor) > FACTOR_TOLERANCE) {
        breaks.push({
          frame,
          what: `HUD part ${part.key} (${entity}) drawn at ${drawn}, the levels give ${factor}`
        });
      }
    }
  };

  return {
    breaks,
    check: () => {
      frame += 1;

      const drawnNow = stage.renderer.renders > lastRenders;

      lastRenders = stage.renderer.renders;
      checkParts();

      if (!drawnNow) return;

      const reports = target.overlays();
      const covered = reports.some(report => report.mode === "cover");
      const pictures = shownPictures();

      if (reports.some(report => report.mode === "freeze") && pictures.count === 0) {
        breaks.push({ frame, what: "a range is kept but no picture of it is shown" });
      }

      const liveNow = new Set<Pixi.Container>();

      for (const leaf of leavesOf(stage.stage, pixi, new Set())) {
        if (drawnLive(leaf, stage.stage)) liveNow.add(leaf);
      }

      for (const leaf of liveBefore) {
        if (liveNow.has(leaf) || !shownButHidden(leaf, stage.stage)) continue;
        if (covered || pictures.leaves.has(leaf) || underPictured(leaf)) continue;

        breaks.push({
          frame,
          what: `${JSON.stringify(leaf.label)} was drawn live and is now neither live nor in a picture`
        });
      }

      liveBefore = liveNow;
    },
    expectAtomic: () => {
      expect(
        breaks.slice(0, 3).map(entry => `frame ${entry.frame}: ${entry.what}`),
        "the first frames that broke K3"
      ).toEqual([]);
    }
  };
}
