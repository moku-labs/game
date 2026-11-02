/**
 * @file renderer/shots — the shots module: `take` queues a key and asks for a frame, the frame reads its canvas into a
 * small soft texture under that key, and a provider answers the key through the texture chain. `sync` reads
 * `ctx.state.shots.wanted` to keep the look of a scene being left out of the frame, through the state alone.
 */
import type { PixiModule, PixiRenderTexture, RendererCtx, ShotsModule } from "../types";
import { sigmaOf } from "./chain";
import { drawShot } from "./passes";
import { createShotPipes } from "./shader";
import { createShotTexture, forgetShots } from "./state";
import type { ShotsConfig, ShotsDeps, ShotsState } from "./types";

/** Shots kept when `shots.keep` is left out. */
const DEFAULT_KEEP = 8;

/**
 * Compiles the pipelines of a device, off the main thread. What ends on a device that is no longer the live one is
 * dropped, a failure too: the restore compiles again. A failure on the live device leaves `take` a no-op, and warns
 * once.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The modules it reads.
 * @param device - The device.
 */
async function compilePipes(ctx: RendererCtx, deps: ShotsDeps, device: GPUDevice): Promise<void> {
  const state = ctx.state.shots;

  try {
    const pipes = await createShotPipes(device);

    if (deps.host.device() === device) state.pipes = pipes;
  } catch (error) {
    if (deps.host.device() !== device || state.warned) return;

    state.warned = true;
    ctx.log.warn("renderer:shots-unavailable", { error });
  }
}

/**
 * The texture of the oldest shot, which leaves its key to a new one, once `keep` shots stand.
 *
 * @param state - The shots branch of the plugin state.
 * @param keep - The limit.
 * @param stale - The keys whose views look again: the key that went joins them.
 * @returns Its texture, or `undefined` while there is room.
 */
function recycled(state: ShotsState, keep: number, stale: string[]): PixiRenderTexture | undefined {
  const [oldest] = state.taken;

  if (oldest === undefined || state.taken.size < keep) return undefined;

  state.taken.delete(oldest[0]);
  stale.push(oldest[0]);

  return oldest[1];
}

/**
 * Seats every wanted key on a texture: its own for a retake, as the newest; the oldest's at the limit; a new one
 * otherwise. Keys may end on one texture when a frame wants more than `keep`.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The modules it reads.
 * @param pixi - The module that draws.
 * @param shots - The config.
 * @param stale - The keys whose views look again: the keys that went join them.
 * @returns The textures to draw, each once.
 */
function seatWanted(
  ctx: RendererCtx,
  deps: ShotsDeps,
  pixi: PixiModule,
  shots: Readonly<ShotsConfig>,
  stale: string[]
): Set<PixiRenderTexture> {
  const state = ctx.state.shots;
  const keep = shots.keep ?? DEFAULT_KEEP;
  const seats = new Set<PixiRenderTexture>();

  for (const key of state.wanted) {
    const held = state.taken.get(key);

    state.taken.delete(key);

    const texture =
      held ?? recycled(state, keep, stale) ?? createShotTexture(pixi, deps.host, shots);

    state.taken.set(key, texture);
    seats.add(texture);
  }

  return seats;
}

/**
 * Reads this frame's canvas into the wanted keys, once, and asks for one more frame: the look shows from it, and the
 * views of the keys, which look again, draw from it. Nothing that can be read: nothing is taken.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The modules it reads.
 */
function shoot(ctx: RendererCtx, deps: ShotsDeps): void {
  const { shots } = ctx.config;
  const { pipes, wanted } = ctx.state.shots;
  const device = deps.host.device();
  const pixi = deps.host.pixi();
  const canvas = deps.host.canvasTexture();

  if (shots === undefined || pipes === undefined) return;
  if (device === undefined || pixi === undefined || canvas === undefined) return;

  const stale = [...wanted];
  const targets: GPUTexture[] = [];

  for (const texture of seatWanted(ctx, deps, pixi, shots, stale)) {
    const target = deps.host.gpuTexture(texture.source);

    if (target !== undefined) targets.push(target);
  }

  drawShot(
    device,
    pipes,
    canvas,
    targets,
    sigmaOf(shots.blur, shots.width, deps.viewport.size().width)
  );
  deps.sync.textures.invalidate(stale);
  deps.demand.request();
}

/**
 * Creates the shots module. It keeps nothing of its own: the plugin builds its modules more than once over one state.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The modules it reads.
 * @returns The shots API and its internal half.
 */
export function createShotsApi(ctx: RendererCtx, deps: ShotsDeps): ShotsModule {
  const state = ctx.state.shots;

  return {
    take: (key: string): void => {
      if (state.pipes === undefined || !deps.host.ready()) return;
      if (ctx.deps.world.ecs.mode() !== "live") return;

      if (!state.wanted.includes(key)) state.wanted.push(key);
      deps.demand.request();
    },

    has: (key: string): boolean => state.taken.has(key),

    start: (): void => {
      if (ctx.config.shots === undefined) return;

      state.off ??= deps.sync.textures.provide(key => state.taken.get(key));

      const device = deps.host.device();

      if (device !== undefined) void compilePipes(ctx, deps, device);
    },

    after: (drawn: boolean): void => {
      // per frame: nothing wanted, one length read.
      if (state.wanted.length === 0) return;

      if (drawn) shoot(ctx, deps);

      state.wanted.length = 0;
    },

    forget: (): void => forgetShots(state)
  };
}
