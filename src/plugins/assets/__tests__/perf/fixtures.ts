/**
 * @file assets plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds the mock
 * plugin outside any measured window and hands back the call it measures: what the world calls when an element lost
 * `Exiting` (whether the bundles a leaving scene named may go, F51), a view's ask for a loaded key, and the victim pick
 * of a budget pass (F184).
 */
import { alloc } from "../../../../../tests/perf/alloc";
import type { NodeInfo } from "../../../flow/types";
import { lookupTexture } from "../../api";
import { pickVictim, releaseSceneLeft } from "../../budget";
import { neighbourhood } from "../../preload";
import { passReadyNode, stepReady } from "../../ready";
import { loadBundle } from "../../tiers";
import { createMockAssets, graphOf, leaving, manifestOf, sceneOf } from "../unit/mock-assets";

/** Calls before a window: the check reaches its optimized tier first. */
const WARM_CALLS = 30_000;

/** Calls of a window. */
const CALLS = 100_000;

/**
 * The heap bytes one call keeps: the call run until V8 optimized it, outside the window, then `alloc` over a window
 * of `CALLS`.
 *
 * @param fn - The call.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/** The frame a system of phase `sync` gets: one kept object, its game clock moved by the fixture. */
type Frame = { time: { elapsed: number } };

/**
 * One frame of the system `assets.ready` (F202): at rest, no `ready` waiting for a warm view, or while one waits for a
 * build that goes on, under its cap.
 *
 * @param waiting - Whether a `ready` waits for a warm view in work.
 * @returns The run the world makes in phase `sync`.
 */
export function readyStep(waiting: boolean): () => void {
  const mock = createMockAssets();
  const frame: Frame = { time: { elapsed: 0 } };

  if (waiting) {
    mock.world.left = 3;
    mock.ctx.state.readyWait = "warm";
    mock.ctx.state.readySince = 0;
  }

  // The fixture must measure the path it names.
  stepReady(mock.assetsCtx, frame);

  if (mock.ctx.state.readyWait !== (waiting ? "warm" : "none") || mock.flow.posted.length > 0) {
    throw new Error("readyStep: the wait is not as asked");
  }

  return () => stepReady(mock.assetsCtx, frame);
}

/**
 * The end of an exit while no scene leaves.
 *
 * @returns The call the world makes.
 */
export function exitEndNothingLeaves(): () => void {
  const mock = createMockAssets();

  return () => releaseSceneLeft(mock.assetsCtx);
}

/**
 * The end of one exit of many while a scene leaves: another element still carries `Exiting`, so nothing goes.
 *
 * @returns The call the world makes.
 */
export function exitEndStillExiting(): () => void {
  const mock = createMockAssets();

  mock.ctx.state.sceneLeaving = ["board.chains"];
  mock.ctx.state.exiting = 2;

  return () => releaseSceneLeft(mock.assetsCtx);
}

/**
 * The sync of a frame while a dropped `"leave"` bundle is still drawn by a view (a reward picture in flight, F246):
 * the retry asks `used` again and keeps it.
 *
 * @returns The call the world makes.
 */
export async function leftStillDrawn(): Promise<() => void> {
  const mock = createMockAssets({
    manifest: leaving(
      manifestOf({ board: { feature: "board", tier: "scene", keys: ["board.cell", "board.bg"] } }),
      "board"
    )
  });

  await mock.start();
  await loadBundle(mock.assetsCtx, "board", undefined, "request");
  mock.renderer.drawn.add("board.bg");
  mock.ctx.state.sceneLeaving = ["board"];
  releaseSceneLeft(mock.assetsCtx);

  // The fixture must measure the path it names.
  if (mock.ctx.state.leftDrawn.length !== 1 || !mock.api.isLoaded("board")) {
    throw new Error("leftStillDrawn: the bundle is not kept for a retry");
  }

  return () => releaseSceneLeft(mock.assetsCtx);
}

/**
 * A view's ask for a key whose bundle is loaded: the hit path of the texture provider, which `renderer` calls for
 * every view after an invalidate (F184 keeps it as it was: a touch and a map read).
 *
 * @returns The call the renderer makes.
 */
export async function lookupHit(): Promise<() => void> {
  const mock = createMockAssets({
    manifest: manifestOf({
      board: { feature: "board", tier: "scene", keys: ["board.cell", "board.bg"] }
    })
  });

  await mock.start();
  await loadBundle(mock.assetsCtx, "board", undefined, "request");

  return () => void lookupTexture(mock.assetsCtx, "board.cell");
}

/**
 * The victim pick of a budget pass over 20 loaded bundles of 3 keys each, every other one drawn by a view by its last
 * key, the oldest among them: the pick walks every record and asks `used` of each bundle older than its best so far.
 *
 * @returns The call `enforceBudget` makes once per eviction.
 */
export async function pickHalfDrawn(): Promise<() => void> {
  const names = Array.from({ length: 20 }, (_, index) => `b${index}`);
  const bundles = Object.fromEntries(
    names.map(name => [
      name,
      { feature: name, tier: "lazy", keys: [`${name}.one`, `${name}.two`, `${name}.three`] }
    ])
  );
  const mock = createMockAssets({ manifest: manifestOf(bundles) });

  await mock.start();

  for (const name of names) await loadBundle(mock.assetsCtx, name, undefined, "request");

  mock.renderer.drawn = new Set(
    names.filter((_, index) => index % 2 === 0).map(name => `${name}.three`)
  );

  return () => void pickVictim(mock.assetsCtx);
}

/**
 * The look-ahead of one rest on a hub with six windows, as A Memory Missing's ward rests between them (F194): each
 * window has a scene whose `bundles` reads the session, the manifest holds 48 bundles of 8 features, and the committed
 * state stays the same from one rest to the next.
 *
 * @returns The call the `flow:rest` hook makes through `startPreload`.
 */
export async function restLookAhead(): Promise<() => void> {
  const features = ["ward", "shop", "goals", "mail", "album", "daily", "quests", "storage"];
  const bundles: Record<string, { feature: string; tier: "feature" | "scene"; keys: string[] }> =
    {};

  for (const feature of features) {
    for (let index = 0; index < 6; index += 1) {
      bundles[`${feature}.${index}`] = {
        feature,
        tier: index === 0 ? "scene" : "feature",
        keys: [`${feature}.k${index}`]
      };
    }
  }

  const mock = createMockAssets({ manifest: manifestOf(bundles), preloadDepth: 2 });
  const windows = features.slice(1, 7);

  await mock.start();
  mock.flow.graph = graphOf(
    {
      main: {
        hub: { owner: "ward", scene: "ward", rest: true },
        ...Object.fromEntries(windows.map(name => [name, { owner: name, scene: name }]))
      }
    },
    { main: { hub: Object.fromEntries(windows.map(name => [`open.${name}`, name])) } }
  );
  mock.flow.stack = [{ flow: "main", node: "hub", input: 0 }];
  mock.model.session = { episode: "ep01" };
  mock.ctx.state.scenes = new Map(
    features.map(name => [
      name,
      sceneOf(name, `${name}.0`, ({ session }) => [
        `${(session as { episode: string }).episode}.${name}`
      ])
    ])
  );
  mock.ctx.state.featureOfFlow = new Map([["main", "ward"]]);
  mock.ctx.state.current = {
    path: "hub",
    flow: "main",
    node: "hub",
    rest: true,
    over: false,
    checkpoint: false,
    barrier: false,
    scene: "ward"
  } as NodeInfo;

  return () => void neighbourhood(mock.assetsCtx, 2);
}

/**
 * Builds the info of a node of the flow "main".
 *
 * @param node - The node's name.
 * @param rest - Whether the graph rests there.
 * @returns The info.
 */
function infoOf(node: string, rest: boolean): NodeInfo {
  return { path: node, flow: "main", node, rest, over: false, checkpoint: false, barrier: false };
}

/**
 * A node entered while no `ready` ask waits for its rest: the common case of every node (F204).
 *
 * @returns The call the `load` stage makes.
 */
export function readyNodeNoAsk(): () => void {
  const mock = createMockAssets();
  const board = infoOf("board", true);

  return () => passReadyNode(mock.assetsCtx, board);
}

/**
 * The first rest entered after a transit node's `ready` ask, a rest that does not list `ready`: the graph is read and
 * the ask ends. The ask is set again before each call (F204).
 *
 * @returns The call the `load` stage makes.
 */
export function readyNodeRestWithoutReady(): () => void {
  const mock = createMockAssets();
  const board = infoOf("board", true);
  const state = mock.assetsCtx.state;

  mock.flow.graph = graphOf({ main: { show: {}, board: { rest: true } } });

  return () => {
    state.readyPlace = "before";
    passReadyNode(mock.assetsCtx, board);
  };
}
