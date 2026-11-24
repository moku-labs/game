/**
 * @file ui plugin — the perf fixture of a reconcile whose elements all stayed (change 2026-11-24-f230-hot-path, U2):
 * the stayed root of the perf app, 108 elements, handed one of two prebuilt equal trees in turn, then reconciled and
 * solved, as a render that says the same reaches `ui`. The trees are built once at load: the fixture allocates nothing
 * in a window. The same root handed the tree with three titles changed, in turn with the first, is the bench's other
 * case.
 */
import { Tree } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { UiCounters } from "../../components";
import type { DescriptionNode } from "../../jsx/types";
import { STAYED } from "./app";
import { type PerfUi, type Step, startPerfUi } from "./fixtures";

/** The elements of the stayed root, one Yoga node each. */
const STAYED_ELEMENTS = 108;

/** The patch that only marks the root's `Tree` changed: its node was written in place. */
const NO_PATCH: object = Object.freeze({});

/** Frames that bring the enter motions of the stayed root to rest. */
const SETTLE_FRAMES = 60;

/** The started perf app with the stayed root at rest, and the two renders a window runs. */
export type StayedPerf = {
  ui: PerfUi;
  /** The root handed the other of the two equal trees, then reconciled and solved. */
  stayed: Step;
  /** The root handed the tree with three titles changed and the first in turn, then reconciled and solved. */
  changed: Step;
};

/**
 * The entity of the stayed root: the one whose `Tree` carries the first prebuilt tree.
 *
 * @param ui - The started perf app.
 * @returns The root's entity.
 */
function stayedRoot(ui: PerfUi): Entity {
  const ecs = ui.app.world.ecs;

  for (const [entity] of ecs.query(Tree)) {
    if (ecs.get(entity, Tree)?.node === STAYED.first) return entity;
  }

  throw new Error("perf: the stayed root was not mounted");
}

/**
 * One render of the root: its `Tree` takes the tree in place and is marked changed, then the two
 * systems of phase `layout` run.
 *
 * @param ui - The started perf app.
 * @param root - The root's entity.
 * @param one - One tree of the pair.
 * @param other - The other.
 * @returns The render, which hands the root the tree it does not hold.
 */
function alternate(ui: PerfUi, root: Entity, one: object, other: object): Step {
  const ecs = ui.app.world.ecs;
  const tree = ecs.get(root, Tree) as { node: unknown } | undefined;

  if (tree === undefined) throw new Error("perf: the stayed root has no Tree");

  return (): void => {
    tree.node = tree.node === one ? other : one;
    ecs.set(root, Tree, NO_PATCH);
    ui.reconcile();
    ui.solve();
  };
}

/**
 * Starts the perf app, mounts the stayed root and runs frames until it rests.
 *
 * @returns The app and the two renders.
 */
export async function startStayedPerf(): Promise<StayedPerf> {
  const ui = await startPerfUi();
  const counters = ui.app.world.ecs.resource(UiCounters);
  const before = counters.nodes;

  ui.app.world.projection.mount(["stayed"], { kind: "plugin", name: "perf" });

  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) ui.app.time.step(16);

  if (counters.nodes - before !== STAYED_ELEMENTS) {
    throw new Error(`perf: the stayed root made ${counters.nodes - before} nodes`);
  }

  const root = stayedRoot(ui);
  const first: DescriptionNode = STAYED.first;

  return {
    ui,
    stayed: alternate(ui, root, first, STAYED.second),
    changed: alternate(ui, root, first, STAYED.changed)
  };
}
