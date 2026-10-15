/**
 * @file Harnesses of the render-on-demand unit tests. Not a test. `demandAlone` builds the demand
 * module over a stand-in host and a map of real Pixi views, for the decision and the predicate;
 * `startDrawn` runs the whole renderer over the real Pixi of `stagePixi`, with the tree oracle
 * watching every frame, for the marks of `sync`.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";
import { Layer } from "../../world/ecs/define";
import type { AnyComponentValue, Entity } from "../../world/types";
import { createDemandApi } from "../demand/api";
import { createDemandState } from "../demand/state";
import type { View } from "../sync/types";
import type { DemandModule, HostModule, PixiContainer, RendererCtx } from "../types";
import { createMockRenderer, type MockRenderer } from "./mock-renderer";
import { type FrameOracle, watchFrames } from "./stage-oracle";
import { type StagePixi, stagePixi } from "./stage-pixi";

/** The owner every spawned entity of these tests carries. */
export const OWNER = { kind: "plugin", name: "test" } as const;

/** The demand module alone, and the handles a test drives it with. */
export type DemandAlone = {
  demand: DemandModule;
  ctx: RendererCtx;
  /** The stage the views hang under, 1080 x 1920 CSS px of screen. */
  stage: pixi.Container;
  views: Map<Entity, View>;
  /** What `time.wakes()` answers. */
  time: { wakes: number };
  host: {
    ready: boolean;
    renders: number;
    /** What `pixels()` answers next. */
    picture: Uint8ClampedArray | undefined;
  };
  log: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  /** Hangs a real Pixi object under a parent as the view of an entity. */
  view(entity: Entity, object: PixiContainer, parent?: PixiContainer): View;
};

/**
 * A view of a real Pixi object, as `sync` builds one.
 *
 * @param object - The display object.
 * @returns The view.
 */
export function viewOf(object: PixiContainer): View {
  return {
    object,
    kind: "Display",
    poolKey: "Display:",
    layer: "",
    textureKey: "",
    wrapper: undefined,
    placeholder: false,
    mask: undefined,
    clipped: undefined,
    display: undefined,
    value: undefined,
    drawScale: { x: 1, y: 1 },
    frameKey: "",
    outline: undefined,
    hitBox: { x: 0, y: 0, width: 0, height: 0 },
    drawn: undefined,
    clipDrawn: undefined,
    hiddenSelf: 0,
    hiddenTop: 0
  };
}

/**
 * Builds the demand module over a stand-in host: a real stage of a 1080 x 1920 screen, a ready
 * flag, a render counter and the pixels a test sets.
 *
 * @param options - The switch of the renderer, on when left out, and whether the stage is a render
 *   group, as a stage Pixi rendered once is.
 * @param options.onDemand - `config.onDemand`.
 * @param options.renderGroup - True for a stage with Pixi's change lists.
 * @returns The module and its handles.
 */
export function demandAlone(
  options: { onDemand?: boolean; renderGroup?: boolean } = {}
): DemandAlone {
  const stage = new pixi.Container({ isRenderGroup: options.renderGroup === true });
  const screen = new pixi.Rectangle(0, 0, 1080, 1920);
  const views = new Map<Entity, View>();
  const time = { wakes: 0 };
  const hostState: DemandAlone["host"] = { ready: true, renders: 0, picture: undefined };
  const log = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
  const host = {
    ready: () => hostState.ready,
    stage: () => stage,
    screen: () => screen,
    pixi: () => pixi,
    pixels: () => hostState.picture,
    render: () => {
      hostState.renders += 1;

      return true;
    }
  } as unknown as HostModule;
  const ctx = {
    config: { onDemand: options.onDemand ?? true, background: 0 },
    state: { demand: createDemandState(), sync: { root: stage, views } },
    log,
    deps: { time: { wakes: () => time.wakes, snapshot: () => ({ frame: 7 }) } }
  } as unknown as RendererCtx;

  return {
    demand: createDemandApi(ctx, { host, views }),
    ctx,
    stage,
    views,
    time,
    host: hostState,
    log,
    view: (entity, object, parent = stage) => {
      const view = viewOf(object);

      parent.addChild(object);
      views.set(entity, view);

      return view;
    }
  };
}

/**
 * A real Pixi graphics of a given size at a place: a leaf the off-screen test can measure.
 *
 * @param x - Left edge, in stage px.
 * @param y - Top edge, in stage px.
 * @param size - Width and height.
 * @returns The graphics.
 */
export function box(x: number, y: number, size = 40): pixi.Graphics {
  const graphics = new pixi.Graphics().rect(0, 0, size, size).fill(0xff_00_00);

  graphics.position.set(x, y);

  return graphics;
}

/** The whole renderer over real Pixi, its tree oracle and the frame driver. */
export type Drawn = {
  mock: MockRenderer;
  stage: StagePixi;
  oracle: FrameOracle;
  /** A real 64 x 64 texture every key answers. */
  texture: pixi.Texture;
  /** One frame: the sync pass, the change sets closed, then input and render; true when drawn. */
  frame(): boolean;
  /** Frames in a row; answers how many were drawn. */
  frames(count: number): number;
  /** Spawns an entity in the `items` layer with these components, its view built in the next frame. */
  spawn(...components: AnyComponentValue[]): Entity;
  /** The real Pixi object of an entity's view. */
  objectOf(entity: Entity): PixiContainer | undefined;
};

/**
 * Starts the renderer over the real Pixi of `stagePixi` with one `items` layer (sorted by
 * `Order`) and the oracle watching every frame, and runs the first frames so the tree rests.
 *
 * @param options - The switch and the dev flag.
 * @param options.onDemand - `config.onDemand`; on when left out.
 * @param options.dev - Stubs `__MOKU_GAME_DEV__` true.
 * @returns The running renderer.
 */
export async function startDrawn(
  options: { onDemand?: boolean; dev?: boolean } = {}
): Promise<Drawn> {
  if (options.dev === true) vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const stage = stagePixi();
  const mock = createMockRenderer({
    config: {
      onDemand: options.onDemand ?? true,
      loadPixi: () => Promise.resolve(stage.module)
    }
  });
  const texture = new pixi.Texture({ source: new pixi.TextureSource({ width: 64, height: 64 }) });

  await mock.start();
  mock.api.sync.textures.provide(() => texture);
  mock.world.projection.setLayers([{ name: "items", sort: "order" }]);

  const oracle = watchFrames(stage.last(), pixi);
  const frame = (): boolean => {
    const before = stage.renders();

    mock.modules.sync.pass();
    mock.world.clearChanges();
    mock.runPhase("input");
    mock.runPhase("render");
    oracle.check();

    return stage.renders() > before;
  };
  const drawn: Drawn = {
    mock,
    stage,
    oracle,
    texture,
    frame,
    frames: count => {
      let total = 0;

      for (let index = 0; index < count; index += 1) total += frame() ? 1 : 0;

      return total;
    },
    spawn: (...components) =>
      mock.world.ecs.spawn(OWNER, [Layer({ name: "items" }), ...components]),
    objectOf: entity => mock.ctx.state.sync.views.get(entity)?.object
  };

  drawn.frames(2);

  return drawn;
}
