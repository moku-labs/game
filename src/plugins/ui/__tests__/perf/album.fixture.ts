/**
 * @file ui plugin — the perf fixture of the album swipe (change 2026-11-26-f244-album-swipe): the album root of the
 * perf app on its set page, handed the prebuilt trees of a swipe, then reconciled, solved and entered, as a commit of
 * the game's pager reaches `ui`. A turn swaps the two pages of the strip and moves the wide dot: it mounts and drops
 * nothing. A swipe walks peek, turn, peek, turn through the 15 sets: every peek mounts a page and drops one.
 */
import { Tree } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { UiCounters } from "../../components";
import type { DescriptionNode } from "../../jsx/types";
import { ALBUM, ALBUM_SETS } from "./album";
import { type PerfUi, type Step, startPerfUi } from "./fixtures";

/** The patch that only marks the root's `Tree` changed: its node was written in place. */
const NO_PATCH: object = Object.freeze({});

/** Frames that bring the enter motions of the album root to rest. */
const SETTLE_FRAMES = 60;

/** The started perf app with the album root at rest on set 0, set 1 peeking, and its renders. */
export type AlbumPerf = {
  ui: PerfUi;
  /** The Yoga nodes the album root made: its elements. */
  elements: number;
  /** The root's tree written and marked changed: the render a commit brings, before `ui` runs. */
  render: (tree: DescriptionNode) => void;
  /**
   * One turn and back: the two pages of the strip swap places, then the frame step of phase `animate`, the reconcile,
   * the solve and the enter.
   */
  turn: Step;
  /** The next step of the swipe through the sets, then one whole frame of the app. */
  swipe: Step;
  /**
   * The reconcile of a turn alone: the root's tree is written, `ui.reconcile` runs, nothing else. Every
   * `RECONCILE_SETTLE` calls it also solves, enters and runs frames, so the entities and the layout of the root do not
   * pile up; a median is not moved by that one call in 64.
   */
  turnReconcile: Step;
  /**
   * The reconcile of a peek alone: the root's tree goes between `turned[0]` and `peek[1]`, so every call mounts the
   * page beside and drops the other, as a peek does; nothing else runs but the settle of `turnReconcile`.
   */
  peekReconcile: Step;
};

/** Calls of a reconcile-only step between two settles of the root. */
const RECONCILE_SETTLE = 64;

/**
 * The entity of the album root: the one whose `Tree` carries the first peek.
 *
 * @param ui - The started perf app.
 * @returns The root's entity.
 */
function albumRoot(ui: PerfUi): Entity {
  const ecs = ui.app.world.ecs;

  for (const [entity] of ecs.query(Tree)) {
    if (ecs.get(entity, Tree)?.node === ALBUM.first) return entity;
  }

  throw new Error("perf: the album root was not mounted");
}

/**
 * Starts the perf app, mounts the album root and runs frames until it rests.
 *
 * @returns The app and the album's renders.
 */
export async function startAlbumPerf(): Promise<AlbumPerf> {
  const ui = await startPerfUi();
  const ecs = ui.app.world.ecs;
  const counters = ecs.resource(UiCounters);
  const before = counters.nodes;

  ui.app.world.projection.mount(["album"], { kind: "plugin", name: "perf" });

  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) ui.app.time.step(16);

  const root = albumRoot(ui);
  // The value the world keeps, written in place below: `get` hands it read-only.
  const tree = ecs.get(root, Tree) as { node: DescriptionNode } | undefined;

  if (tree === undefined) throw new Error("perf: the album root has no Tree");

  const render = (node: DescriptionNode): void => {
    tree.node = node;
    ecs.set(root, Tree, NO_PATCH);
  };
  // The frame of a commit: phase `animate`, whose step ends the 0 ms rest tracks the turn before started, then the
  // systems of `ui` a commit runs, the layout phase and the enter of phase `sync`. Without the step every turn would
  // keep the tracks it started in anim's list. A turn marks the same entities at every call, so its change lists stay
  // as they are.
  const frame = (): void => {
    ui.animate();
    ui.reconcile();
    ui.solve();
    ui.enter();
  };
  // The step of each walk lives in a cell: a number in a closure would be a new heap number.
  const at = new Int32Array(6);
  // The reconcile alone leaves the solve and the enter undone: now and then they run, outside what a median sees.
  const settle = (): void => {
    at[5] = (at[5] ?? 0) + 1;

    if ((at[5] ?? 0) % RECONCILE_SETTLE !== 0) return;

    ui.solve();
    ui.enter();

    for (let step = 0; step < SETTLE_FRAMES; step += 1) ui.app.time.step(16);
  };

  return {
    ui,
    elements: counters.nodes - before,
    render,
    turn: (): void => {
      at[0] = at[0] === 0 ? 1 : 0;
      render(at[0] === 1 ? (ALBUM.turned[0] as DescriptionNode) : ALBUM.first);
      frame();
    },
    swipe: (): void => {
      // Step 2n: set n on show, n + 1 peeking (step 0 is where the root rests); step 2n + 1: turned to n + 1.
      const step = ((at[1] ?? 0) + 1) % (2 * ALBUM_SETS);
      const set = step >> 1;

      at[1] = step;
      render(
        step % 2 === 0
          ? (ALBUM.peek[set] as DescriptionNode)
          : (ALBUM.turned[set] as DescriptionNode)
      );
      // A whole frame of the app: a peek mounts a page and drops one, and phase `signals` empties the change lists.
      ui.app.time.step(16);
    },
    turnReconcile: (): void => {
      at[2] = at[2] === 0 ? 1 : 0;
      render(at[2] === 1 ? (ALBUM.turned[0] as DescriptionNode) : ALBUM.first);
      ui.reconcile();
      settle();
    },
    peekReconcile: (): void => {
      at[3] = at[3] === 0 ? 1 : 0;
      render(
        at[3] === 1 ? (ALBUM.turned[0] as DescriptionNode) : (ALBUM.peek[1] as DescriptionNode)
      );
      ui.reconcile();
      settle();
    }
  };
}
