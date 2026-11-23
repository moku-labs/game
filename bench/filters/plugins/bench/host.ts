/**
 * @file The bench plugin's seam with the engine: the host its work reads, and what it does when the
 * game starts, enters its scene and stops.
 */
import type { Assets, Clock, Flow, Renderer, Scenes, World } from "../../../../src/index.ts";
import type { Perspective } from "../../features/bench/scenes/types";
import { type BenchHost, benchFrame, followAddress } from "./api";
import type { BenchState } from "./types";

/** The log as the bench writes to it. */
type BenchLog = { warn(event: string, data: Record<string, string>): void };

/** The scene the graph starts on, where the address is followed. */
const BENCH_SCENE = "bench";

/** The answer that takes the graph from each of its two scenes to the other: the `trans-*` arms' switch. */
const SWITCH_INTENT: Readonly<Record<string, string>> = { bench: "over", "bench-b": "back" };

/**
 * The address of the page.
 *
 * @returns `location.hash`; empty without a page.
 */
function hashOfPage(): string {
  return typeof location === "undefined" ? "" : location.hash;
}

/** Pixi's module, loaded lazily once the bench starts: what a perspective mesh is made with. */
type PixiModule = typeof import("pixi.js");

/** The Pixi module once it is loaded. */
type PixiHolder = { pixi: PixiModule | undefined };

/** The subdivisions of a perspective mesh a side: Pixi's own default. */
const MESH_VERTICES = 10;

/**
 * Loads Pixi into the holder, once.
 *
 * @param holder - Where it goes.
 */
export function loadPixi(holder: PixiHolder): void {
  import("pixi.js")
    .then(module => {
      holder.pixi = module;
    })
    .catch(() => undefined);
}

/**
 * A perspective mesh of a texture, its corners written in place.
 *
 * @param holder - Pixi, once loaded.
 * @param texture - The Pixi texture.
 * @returns The mesh; `undefined` before Pixi or the texture is there.
 */
function perspectiveOf(holder: PixiHolder, texture: unknown): Perspective | undefined {
  const { pixi } = holder;

  if (pixi === undefined || texture === undefined) return undefined;

  const mesh = new pixi.PerspectiveMesh({
    texture: texture as InstanceType<PixiModule["Texture"]>,
    verticesX: MESH_VERTICES,
    verticesY: MESH_VERTICES
  });

  return {
    object: mesh,
    corners: (x0, y0, x1, y1, x2, y2, x3, y3) => mesh.setCorners(x0, y0, x1, y1, x2, y2, x3, y3)
  };
}

/**
 * The engine as the bench reads it.
 *
 * @param world - The world plugin.
 * @param renderer - The renderer plugin.
 * @param clock - The clock plugin.
 * @param log - The log.
 * @param flow - The flow plugin: its gate takes the answer that switches the scene.
 * @param scenes - The scenes plugin: which scene stands.
 * @param assets - The assets plugin and Pixi: the texture and the class of a perspective mesh.
 * @param assets.api - The assets plugin: a texture by its key.
 * @param assets.holder - Pixi, once loaded.
 * @returns The host.
 */
export function hostOf(
  world: Pick<World.Api, "ecs">,
  renderer: Pick<Renderer.Api, "viewport" | "stats" | "monitor">,
  clock: Pick<Clock.Api, "now">,
  log: Pick<BenchLog, "warn">,
  flow: Pick<Flow.Api, "gate">,
  scenes: Pick<Scenes.ScenesApi, "current">,
  assets: { api: Pick<Assets.Api, "texture">; holder: PixiHolder }
): BenchHost {
  return {
    ecs: world.ecs,
    screen: () => renderer.viewport.size(),
    stats: () => renderer.stats(),
    monitor: renderer.monitor,
    now: () => clock.now(),
    warn: (event, data) => log.warn(event, data),
    scene: () => scenes.current(),
    switchScene: () => {
      const intent = SWITCH_INTENT[scenes.current() ?? ""];

      return intent !== undefined && flow.gate.answer({ intent });
    },
    perspective: texture => perspectiveOf(assets.holder, assets.api.texture(texture))
  };
}

/**
 * Follows the address when the game enters the bench's scene for the first time, and tells the arm on screen about a
 * switch of scenes: its swap.
 *
 * @param state - The bench's state.
 * @param to - The scene entered.
 */
export function enterScene(state: BenchState, to: string): void {
  if (state.scene !== undefined) {
    state.mounted?.swapped?.(to);

    return;
  }

  if (to !== BENCH_SCENE || state.host === undefined) return;

  followAddress(state, state.host, hashOfPage());
}

/**
 * Turns the arms every frame and follows the address from now on.
 *
 * @param state - The bench's state.
 * @param onFrame - Runs a callback every frame with the elapsed time, and answers how to stop it.
 */
export function startBench(
  state: BenchState,
  onFrame: (run: (elapsed: number) => void) => () => void
): void {
  const { host } = state;

  if (host === undefined) return;

  const follow = (): void => followAddress(state, host, hashOfPage());

  state.off.push(onFrame(elapsed => benchFrame(state, host, elapsed)));

  if (typeof addEventListener === "function") {
    addEventListener("hashchange", follow);
    state.off.push(() => removeEventListener("hashchange", follow));
  }
}

/**
 * Lets go of everything `startBench` took.
 *
 * @param state - The bench's state.
 */
export function stopBench(state: BenchState): void {
  for (const off of state.off.splice(0)) off();
}
