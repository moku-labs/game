/**
 * @file The stage of the overlay unit tests (spec 22). Not a test. The whole renderer runs over the real Pixi of
 * `stagePixi` with the scene's three layers `scene`, `ui` (sorted by `Order`) and the HUD layer `hud`, the tree
 * oracle, the picture oracle and the atomicity checker watching every frame. Views are spawned as `ui` spawns its
 * elements: owned by `ui`, a `Shape` each; an overlay carries `Overlay` and the engine's `OverlayLevel`, which a test
 * writes the way `ui` does.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";
import { Exiting, Layer, Order } from "../../world/ecs/define";
import type { AnyComponentValue, Entity, LayerSpec } from "../../world/types";
import { Overlay, OverlayLevel, type OverlayValue, Parent, Shape, Transform } from "../components";
import type { Config, PixiContainer } from "../types";
import { type Drawn, startDrawn } from "./demand-harness";
import { type OverlayOracle, watchOverlays } from "./overlay-oracle";
import type { RenderCall } from "./stage-pixi";

/** The owner `ui` gives its elements: the only overlays the renderer honours. */
export const UI_OWNER = { kind: "plugin", name: "ui" } as const;

/** The scene of every overlay test: a scene layer, the ui layer, and the HUD layer above every overlay. */
export const OVERLAY_LAYERS: readonly LayerSpec[] = [
  { name: "scene", sort: "none" },
  { name: "ui", sort: "order" },
  { name: "hud", sort: "none", above: "overlays" }
];

/** Where and how a test view is drawn. */
export type ViewOptions = {
  layer?: string;
  order?: number;
  parent?: Entity;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fill?: number;
  alpha?: number;
  /** More components, a `HudPart`, `Overlay` or a filter's component. */
  extra?: readonly AnyComponentValue[];
};

/** A running overlay stage and its drivers. */
export type OverlayStage = {
  drawn: Drawn;
  atomic: OverlayOracle;
  /** Spawns a ui-owned view; its view is built in the next frame. */
  view(options?: ViewOptions): Entity;
  /** Spawns a ui-owned overlay root with its marker and a level of 0, not landed. */
  overlay(value?: Partial<OverlayValue>, options?: ViewOptions): Entity;
  /** Writes the engine's level and landing of an overlay, as `ui` does. */
  level(entity: Entity, level: number, landed?: boolean): void;
  /** Tags an overlay `Exiting`, as `ui` does at its exit. */
  leave(entity: Entity): void;
  /** One frame; true when it was drawn. */
  frame(): boolean;
  /** Frames in a row; answers how many were drawn. */
  frames(count: number): number;
  /** The top of an entity's view (`wrapper ?? object`). */
  topOf(entity: Entity): PixiContainer;
  /** A layer container. */
  layer(name: string): PixiContainer;
  /** The stage root of `sync`. */
  root(): PixiContainer;
  /** The renders of the stage root into a texture since a point of the log. */
  rootRenders(from?: number): RenderCall[];
  /** The length of the render log now. */
  mark(): number;
};

/**
 * Starts the renderer with the three layers of an overlay scene and the checkers on every frame.
 *
 * @param options - The switch and other config.
 * @param options.onDemand - `config.onDemand`; on when left out.
 * @param options.dev - Stubs `__MOKU_GAME_DEV__` true, for the dev warnings.
 * @param options.agent - Stubs `__MOKU_GAME_AGENT__` true, for the event lines.
 * @param options.config - Other config, as `keptMb`.
 * @returns The stage.
 */
export async function startOverlayStage(
  options: { onDemand?: boolean; dev?: boolean; agent?: boolean; config?: Partial<Config> } = {}
): Promise<OverlayStage> {
  if (options.agent === true) vi.stubGlobal("__MOKU_GAME_AGENT__", true);

  const drawn = await startDrawn({
    onDemand: options.onDemand ?? true,
    ...(options.dev === undefined ? {} : { dev: options.dev }),
    config: options.config ?? {}
  });
  const { mock } = drawn;
  const ecs = mock.world.ecs;
  const state = mock.ctx.state.sync;

  mock.world.projection.setLayers(OVERLAY_LAYERS);

  const atomic = watchOverlays(
    {
      stage: drawn.stage.last(),
      overlays: () => mock.api.sync.debug.overlays(),
      ecs,
      displayOf: entity => mock.api.sync.displayOf(entity),
      hudLayer: "hud"
    },
    pixi
  );

  /**
   * One frame, checked by the atomicity checker too.
   *
   * @returns True when it was drawn.
   */
  const frame = (): boolean => {
    const drawnNow = drawn.frame();

    atomic.check();

    return drawnNow;
  };

  /**
   * The components of a test view.
   *
   * @param viewOptions - Where and how it is drawn.
   * @returns The components.
   */
  const componentsOf = (viewOptions: ViewOptions): AnyComponentValue[] => [
    ...(viewOptions.parent === undefined
      ? [Layer({ name: viewOptions.layer ?? "ui" })]
      : [Parent({ entity: viewOptions.parent })]),
    Order({ value: viewOptions.order ?? 0 }),
    Transform({ x: viewOptions.x ?? 0, y: viewOptions.y ?? 0 }),
    Shape({
      w: viewOptions.w ?? 100,
      h: viewOptions.h ?? 100,
      fill: viewOptions.fill ?? 0x33_66_99,
      alpha: viewOptions.alpha ?? 1
    }),
    ...(viewOptions.extra ?? [])
  ];

  const stage: OverlayStage = {
    drawn,
    atomic,
    view: (viewOptions = {}) => ecs.spawn(UI_OWNER, componentsOf(viewOptions)),
    overlay: (value = {}, viewOptions = {}) =>
      ecs.spawn(UI_OWNER, [
        ...componentsOf({ w: 1080, h: 1920, ...viewOptions }),
        Overlay(value),
        OverlayLevel()
      ]),
    level: (entity, level, landed) =>
      ecs.set(entity, OverlayLevel, { level, ...(landed === undefined ? {} : { landed }) }),
    leave: entity => ecs.tag(entity, Exiting),
    frame,
    frames: count => {
      let total = 0;

      for (let index = 0; index < count; index += 1) total += frame() ? 1 : 0;

      return total;
    },
    topOf: entity => {
      const view = state.views.get(entity);

      if (view === undefined) throw new Error(`no view for ${entity}`);

      return view.wrapper ?? view.object;
    },
    layer: name => {
      const container = state.layers.get(name)?.container;

      if (container === undefined) throw new Error(`no layer ${name}`);

      return container;
    },
    root: () => {
      if (state.root === undefined) throw new Error("no root");

      return state.root;
    },
    rootRenders: (from = 0) =>
      drawn.stage
        .targets()
        .slice(from)
        .filter(call => call.container === state.root),
    mark: () => drawn.stage.targets().length
  };

  stage.frames(2);

  return stage;
}

/**
 * The checks every overlay test ends with: no missed frame, every picture current, K3 kept; then the renderer stops.
 *
 * @param stage - The stage.
 */
export function endStage(stage: OverlayStage): void {
  stage.drawn.oracle.expectNoMissedFrame();
  stage.drawn.oracle.expectPicturesCurrent();
  stage.atomic.expectAtomic();
  stage.drawn.mock.stop();
}
