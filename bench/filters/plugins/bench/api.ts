/**
 * @file The bench plugin's work: scenes in and out, the ballast, the arms and their rows. It reaches
 * the engine only through `BenchHost`, so the plugin file stays wiring.
 */
import {
  Layer,
  Parent,
  type Renderer,
  Sprite,
  Transform,
  type World
} from "../../../../src/index.ts";
import { BALLAST_LAYER, MAIN_LAYER } from "../../features/bench";
import { SCENES } from "../../features/bench/scenes";
import { PICTURE } from "../../features/bench/scenes/shared";
import type { BenchScene, Stage } from "../../features/bench/scenes/types";
import { readArm } from "../../lib/readout";
import { parseToken } from "../../lib/token";
import type { ArmRow, BenchApi, BenchState, ShowOptions } from "./types";

/** The K of `#ballast` when the address names none. */
const DEFAULT_K = 8;

/** The frames at the head of an arm its summary drops: the switch, and the GPU timer catching up. */
export const SETTLE_FRAMES = 6;

/** The owner of a scene's views. */
const SCENE_OWNER = { kind: "plugin", name: "bench" } as const;

/** The owner of the ballast: a change of scene never touches it. */
const BALLAST_OWNER = { kind: "plugin", name: "bench.ballast" } as const;

/** What the plugin reads of the engine. */
export type BenchHost = {
  ecs: World.EcsApi;
  screen(): { width: number; height: number };
  stats(): Renderer.RenderStats;
  monitor: Pick<Renderer.PerfMonitorApi, "frames" | "mark" | "setResolution">;
  now(): number;
  warn(event: string, data: Record<string, string>): void;
};

/**
 * The state of a fresh page.
 *
 * @returns The state.
 */
export function createBenchState(): BenchState {
  return {
    host: undefined,
    scene: undefined,
    mounted: undefined,
    mountedMs: 0,
    nowMs: 0,
    ballast: [],
    k: 0,
    n: undefined,
    since: 0,
    slot: 0,
    rows: [],
    cycle: undefined,
    off: []
  };
}

/**
 * Finds a scene.
 *
 * @param name - Its name.
 * @returns The scene.
 * @throws {Error} When the table has no such scene.
 */
function sceneOf(name: string): BenchScene {
  const scene = SCENES.find(entry => entry.name === name);

  if (scene !== undefined) return scene;

  const known = SCENES.map(entry => entry.name).join(", ");

  throw new Error(`[bench] No scene "${name}".\n  Known: ${known}.`);
}

/**
 * The stage a scene mounts on.
 *
 * @param host - The engine.
 * @param n - The count the address named.
 * @returns The stage.
 */
function stageOf(host: BenchHost, n: number | undefined): Stage {
  const { ecs } = host;
  const { width, height } = host.screen();

  return {
    width,
    height,
    n,
    spawn: (...components) => ecs.spawn(SCENE_OWNER, [Layer({ name: MAIN_LAYER }), ...components]),
    child: (parent, ...components) =>
      ecs.spawn(SCENE_OWNER, [Parent({ entity: parent }), ...components]),
    set: (entity, component, patch) => ecs.set(entity, component, patch),
    despawn: entity => ecs.despawn(entity),
    now: host.now,
    setResolution: resolution => host.monitor.setResolution(resolution)
  };
}

/**
 * Sets the ballast to K sprites; K as it stands spawns nothing, so the fill never stops.
 *
 * @param state - The state.
 * @param host - The engine.
 * @param count - K.
 */
function setBallast(state: BenchState, host: BenchHost, count: number): void {
  if (count === state.ballast.length) return;

  const { ecs } = host;
  const { width, height } = host.screen();

  ecs.despawnOwnedBy(BALLAST_OWNER);
  state.ballast = Array.from({ length: count }, () =>
    ecs.spawn(BALLAST_OWNER, [
      Layer({ name: BALLAST_LAYER }),
      Transform({ x: 0, y: 0 }),
      Sprite({ texture: PICTURE, width, height, anchor: { x: 0, y: 0 } })
    ])
  );
}

/**
 * The row of the arm that runs.
 *
 * @param state - The state.
 * @param host - The engine.
 * @returns The row.
 */
function rowOf(state: BenchState, host: BenchHost): ArmRow {
  const stats = host.stats();

  return {
    scene: state.scene?.name ?? "",
    slot: state.slot,
    k: state.k,
    origin: typeof performance === "undefined" ? 0 : performance.timeOrigin,
    ...readArm(host.monitor.frames(), state.since, SETTLE_FRAMES),
    stats: {
      canvasPasses: stats.canvasPasses,
      canvasPassesMax: stats.canvasPassesMax,
      frameMs: stats.frameMs,
      fps: stats.fps,
      evicted: stats.kept.evicted,
      refused: stats.kept.refused
    }
  };
}

/**
 * Takes the scene off the screen, its row into the run.
 *
 * @param state - The state.
 * @param host - The engine.
 */
function closeScene(state: BenchState, host: BenchHost): void {
  if (state.scene === undefined) return;

  const row = rowOf(state, host);

  state.rows.push(row);
  state.slot += 1;
  host.monitor.mark(
    `arm end ${row.scene} canvas=${row.summary.canvasPasses ?? "none"} gpu=${row.summary.gpuMs?.toFixed(2) ?? "none"}`
  );
  state.mounted?.leave?.();
  state.mounted = undefined;
  state.scene = undefined;
  host.ecs.despawnOwnedBy(SCENE_OWNER);
}

/**
 * Puts a scene on the screen.
 *
 * @param state - The state.
 * @param host - The engine.
 * @param scene - The scene.
 * @param options - K and n.
 */
function openScene(
  state: BenchState,
  host: BenchHost,
  scene: BenchScene,
  options: ShowOptions
): void {
  closeScene(state, host);

  const asked = options.k ?? state.k;

  state.k = scene.name === "ballast" && asked === 0 ? DEFAULT_K : asked;
  state.n = options.n ?? state.n;
  setBallast(state, host, state.k);
  state.scene = scene;
  state.mounted = scene.mount(stageOf(host, state.n));
  state.mountedMs = state.nowMs;
  state.since = host.monitor.frames().written;
  host.monitor.mark(`arm ${scene.name} k=${state.k}`);
}

/**
 * The work of one frame: the tick of the scene, and the turn of the arms.
 *
 * @param state - The state.
 * @param host - The engine.
 * @param elapsedMs - The game time.
 */
export function benchFrame(state: BenchState, host: BenchHost, elapsedMs: number): void {
  state.nowMs = elapsedMs;

  const { cycle } = state;

  if (cycle !== undefined && elapsedMs >= cycle.nextMs) {
    cycle.at = (cycle.at + 1) % cycle.arms.length;
    cycle.nextMs += cycle.everyMs;
    openScene(state, host, sceneOf(cycle.arms[cycle.at] ?? ""), {});
  }

  state.mounted?.tick?.(elapsedMs - state.mountedMs);
}

/**
 * Opens what an address asks for. A scene the table does not have is said in the log, and the
 * page opens the ballast.
 *
 * @param state - The state.
 * @param host - The engine.
 * @param hash - `location.hash`.
 */
export function followAddress(state: BenchState, host: BenchHost, hash: string): void {
  const api = createBenchApi(state, host);
  const token = parseToken(hash);
  const asked = token.arms.length > 0 ? token.arms : [token.scene];
  const unknown = asked.find(name => api.stands(name) === undefined);
  const options = {
    ...(token.k === undefined ? {} : { k: token.k }),
    ...(token.n === undefined ? {} : { n: token.n })
  };

  if (unknown !== undefined) {
    host.warn("bench:unknown-scene", { scene: unknown });
    api.show("ballast", options);
  } else if (token.arms.length > 0) {
    api.play(token.arms, token.every, token.k);
  } else {
    api.show(token.scene, options);
  }
}

/**
 * Makes the bench's API.
 *
 * @param state - The state.
 * @param host - The engine.
 * @returns The API.
 */
export function createBenchApi(state: BenchState, host: BenchHost): BenchApi {
  return {
    names: () => SCENES.map(scene => scene.name),
    stands: scene => SCENES.find(entry => entry.name === scene)?.stands,
    current: () =>
      state.scene === undefined ? undefined : { scene: state.scene.name, k: state.k, n: state.n },
    show: (scene, options = {}) => {
      const found = sceneOf(scene);

      state.cycle = undefined;
      openScene(state, host, found, options);
    },
    play: (arms, every, k) => {
      const [first = ""] = arms;

      for (const arm of arms) sceneOf(arm);

      // A run starts its rows from nothing: what stood before it is no arm of it.
      closeScene(state, host);
      state.rows = [];
      state.slot = 0;
      state.cycle = { arms, everyMs: every * 1000, at: 0, nextMs: state.nowMs + every * 1000 };
      openScene(state, host, sceneOf(first), k === undefined ? {} : { k });
    },
    read: () => rowOf(state, host),
    rows: () => [...state.rows],
    ballast: () => [...state.ballast]
  };
}
