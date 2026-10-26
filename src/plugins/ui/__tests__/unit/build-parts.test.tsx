import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayLevel, Parent } from "../../../renderer/components";
import type { Entity } from "../../../world/types";
import { Box, Scroll, UiCounters } from "../../components";
import type { UiNode } from "../../jsx/types";
import { marked, type Parts, rounded, settle, startParts, untilBuilt } from "../parts-app";

// ---------------------------------------------------------------------------
// Unit: a scene build in parts (spec 33, slice A). A root built aside is reconciled by root and by
// part under the frame's budget, laid out once, and applied in parts; its scrolls, its hosts and
// ui's part of the build wait for the whole. A clock that moves on with every read runs the budget
// out after a known number of reads; a budget of 0 runs it out at the first read. The oracle of
// every build is the same scene mounted in one block.
// ---------------------------------------------------------------------------

const started: Parts[] = [];

afterEach(async () => {
  for (const parts of started.splice(0)) await parts.app.stop();

  vi.restoreAllMocks();
});

/**
 * Starts a fixture and stops it after the test.
 *
 * @param stepMs - Milliseconds every clock read moves the clock on.
 * @returns The started fixture.
 */
async function start(stepMs = 0): Promise<Parts> {
  const parts = await startParts(stepMs);

  started.push(parts);

  return parts;
}

/**
 * The same scenes mounted in one block: the oracle.
 *
 * @param names - The projections besides the ward.
 * @param before - What happens before the mount, as before the build it is compared with.
 * @returns The fixture, three frames after the mount.
 */
async function oneBlock(
  names: readonly string[],
  before?: (parts: Parts) => Promise<void>
): Promise<Parts> {
  const parts = await start();

  await before?.(parts);
  parts.mount(names);

  for (let index = 0; index < 3; index += 1) parts.frame();

  return parts;
}

/**
 * Records the frame every element of a build was made in: `ui` marks each one as the build's
 * right after its spawn.
 *
 * @param parts - The started fixture.
 * @returns The frames by entity, and how many frames were stepped.
 */
function recordMade(parts: Parts) {
  const made = new Map<Entity, number>();
  const clock = { frame: 0 };
  const adopt = parts.app.world.projection.adopt;

  vi.spyOn(parts.app.world.projection, "adopt").mockImplementation(entity => {
    made.set(entity, clock.frame);
    adopt(entity);
  });

  return { made, clock };
}

/**
 * Steps frames until `ui`'s part of the build is done, counting each frame for `recordMade`.
 *
 * @param parts - The started fixture.
 * @param clock - The frame count `recordMade` reads.
 * @param clock.frame - The frame being stepped.
 * @returns The frames stepped.
 */
function stepRecorded(parts: Parts, clock: { frame: number }): number {
  while (!parts.built()) {
    clock.frame += 1;

    if (clock.frame > 200) throw new Error("ui's part of the build was not done in 200 frames");

    parts.frame();
  }

  return clock.frame;
}

/**
 * Commits the build and steps three frames, so the held enters play.
 *
 * @param parts - The started fixture, its part of the build done.
 */
function commitAndSettle(parts: Parts): void {
  parts.commit();

  for (let index = 0; index < 3; index += 1) parts.frame();
}

/**
 * The ids of every entity of the world.
 *
 * @param parts - The started fixture.
 * @returns The ids, sorted.
 */
function idsOf(parts: Parts): number[] {
  return parts.app.world.ecs
    .snapshot()
    .entities.map(entity => entity.id)
    .toSorted((first, second) => first - second);
}

/**
 * How many nodes a snapshot node holds, itself included.
 *
 * @param node - The node.
 * @returns The count.
 */
function sizeOf(node: UiNode | undefined): number {
  return node === undefined ? 0 : 1 + node.children.reduce((sum, child) => sum + sizeOf(child), 0);
}

/**
 * The keys of the elements under a snapshot node whose entity does not hang under its parent's
 * entity: what the renderer would draw out of place.
 *
 * @param parts - The started fixture.
 * @param node - A keyed node of the screen.
 * @returns The keys of the children whose `Parent` is another entity, all the way down.
 */
function strayed(parts: Parts, node: UiNode): string[] {
  const { ecs } = parts.app.world;
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = parts.app.ui.find(node.key ?? "");

  return node.children.flatMap(child => {
    // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
    const own = parts.app.ui.find(child.key ?? "");
    const here =
      own !== undefined && ecs.get(own, Parent)?.entity === entity ? [] : [child.key ?? ""];

    return [...here, ...strayed(parts, child)];
  });
}

/**
 * The level and the landing of the fixture's dim overlay.
 *
 * @param parts - The started fixture.
 * @returns Its `OverlayLevel`, or `undefined` before it is live.
 */
function levelOf(parts: Parts) {
  return parts.app.world.ecs.get(marked(parts, "dim") ?? 0, OverlayLevel);
}

/**
 * The root of the screen whose top element has this key.
 *
 * @param parts - The started fixture.
 * @param key - The key of the root element.
 * @returns The snapshot node.
 */
function rootOf(parts: Parts, key: string): UiNode | undefined {
  return parts.app.ui.tree().children.find(node => node.key === key);
}

describe("a scene built in parts", () => {
  // Bug: the whole root is diffed in the first frame of the build (the long frame this slice
  // exists for), or the parts end in another screen than one block.
  it("makes a root of 300 elements over several frames and ends as one block", async () => {
    const parts = await start(1);
    const { made, clock } = recordMade(parts);

    expect(parts.build(["parts.big"], 3)).toBe(true);
    stepRecorded(parts, clock);

    // Every element once, over three frames at least, the ward on the screen all along.
    expect(made.size).toBe(300);
    expect(new Set(made.values()).size).toBeGreaterThanOrEqual(3);
    expect(parts.app.ui.tree().key).toBe("wardRoot");

    commitAndSettle(parts);

    const block = await oneBlock(["parts.big"]);

    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
  });

  // Bug: the queue of parked parts is taken from its end, so a later part is made first.
  it("diffs parked children in the order they were parked", async () => {
    const parts = await start();
    const { made, clock } = recordMade(parts);

    parts.build(["parts.ordered"], 0);
    stepRecorded(parts, clock);
    commitAndSettle(parts);

    const frameOf = (key: string): number | undefined =>
      // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
      made.get(parts.app.ui.find(key) ?? 0);

    // Both sections came in the first frame and their children waited, the first section's first.
    expect(frameOf("secA")).toBe(frameOf("secB"));
    expect(frameOf("a0")).toBeGreaterThan(frameOf("secA") ?? 0);
    expect(frameOf("b0")).toBeGreaterThan(frameOf("a0") ?? 0);
  });

  // Bug: a commit during the build diffs the root again while parts of it wait, so a part diffed
  // later with its older nodes takes back what the newer tree added, or makes an element again.
  it("makes no element twice when the state changes during the build", async () => {
    const parts = await start(1);
    const { made, clock } = recordMade(parts);

    parts.build(["parts.big"], 3);
    parts.frame();
    parts.frame();

    // Parts are parked: the change lands in the middle of the diff.
    expect(made.size).toBeGreaterThan(0);
    expect(made.size).toBeLessThan(300);
    expect(parts.app.flow.gate.answer({ intent: "grow" })).toBe(true);
    await settle();
    stepRecorded(parts, clock);
    commitAndSettle(parts);

    const block = await oneBlock(["parts.big"], async fixture => {
      fixture.app.flow.gate.answer({ intent: "grow" });
      await settle();
      fixture.frame();
    });
    const big = rootOf(block, "bigRoot");

    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
    // Five cells a row now: every element of the newest tree made once, none made and dropped.
    expect(big?.children[0]?.children).toHaveLength(5);
    expect(made.size).toBe(sizeOf(big));
  });

  // Bug: a commit while the root is applied in parts leaves rows the newer tree dropped, or the root
  // is not laid out and applied again for the tree it ends with.
  it("ends as one block of the newest state when the state changes while the root is applied", async () => {
    const parts = await start();

    parts.build(["parts.big"], 100);
    parts.frame();

    // The application is open: a third of the root is applied, the last rows wait on its stack.
    expect(parts.built()).toBe(false);
    expect(parts.app.flow.gate.answer({ intent: "shrink" })).toBe(true);
    await settle();
    untilBuilt(parts);
    commitAndSettle(parts);

    const block = await oneBlock(["parts.big"], async fixture => {
      fixture.app.flow.gate.answer({ intent: "shrink" });
      await settle();
      fixture.frame();
    });

    expect(rootOf(block, "bigRoot")?.children).toHaveLength(20);
    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
    expect(parts.app.world.ecs.count()).toBe(block.app.world.ecs.count());
  });

  // Bug: every solve of the build opened a new application in parts, so a layout that changes every
  // few frames kept the build from ever being done, and the scene never swapped in.
  it("reaches its end while the state changes the layout in every frame of the build", async () => {
    const parts = await start();
    const intents = ["grow", "shrink"] as const;
    let builtAt = -1;

    parts.build(["parts.big"], 100);

    for (let frame = 0; frame < 60 && builtAt < 0; frame += 1) {
      parts.app.flow.gate.answer({ intent: intents[frame % 2] ?? "grow" });
      await settle();
      parts.frame();
      if (parts.built()) builtAt = frame;
    }

    expect(builtAt).toBeGreaterThanOrEqual(0);
    expect(builtAt).toBeLessThan(20);
  });

  // Bug: a parked part that throws stops the frame's reconcile, or holds the swap for good.
  it("logs a parked part that throws for its root and goes on with the next part", async () => {
    const parts = await start();

    parts.build(["parts.broken"], 0);
    untilBuilt(parts);
    commitAndSettle(parts);

    const failed = parts.app.log
      .trace()
      .filter(entry => entry.event === "ui:root-failed")
      .map(entry => (entry.data as { root?: string }).root);

    expect(failed).toEqual(["parts.broken"]);
    expect(parts.app.ui.find("k1")).toBeDefined();
    expect(parts.app.ui.find("n1")).toBeDefined();
    expect(parts.app.ui.find("brokenField")).toBeUndefined();
  });

  // Bug: the root is solved while parts of it wait (a Yoga solve per frame of the build), or
  // never after its last part.
  it("lays the root out once, after its last part", async () => {
    const parts = await start(1);
    const counters = parts.app.world.ecs.resource(UiCounters);
    const solves = counters.solves;
    const perFrame: number[] = [];

    parts.build(["parts.big"], 3);

    while (!parts.built() && perFrame.length < 200) {
      parts.frame();
      perFrame.push(counters.solves - solves);
    }

    expect(perFrame.length).toBeGreaterThanOrEqual(3);
    expect(perFrame.at(-1)).toBe(1);
    // Not one solve while its parts were parked: the first solve comes after the last part.
    expect(perFrame.filter(count => count === 0).length).toBeGreaterThanOrEqual(2);
  });

  // Bug: the first application of a big root runs whole in one frame (its component flush is the
  // long frame the budget does not see), or the build is reported done before it is applied.
  it("applies at most 100 elements a frame and is not done until the last one", async () => {
    const parts = await start();
    const boxed: number[] = [0];
    const off = parts.app.world.ecs.onAdded(Box, () => {
      boxed[boxed.length - 1] = (boxed.at(-1) ?? 0) + 1;
    });
    const done: boolean[] = [];

    // A budget that never runs out on a clock that stands: the cap alone splits the application.
    parts.build(["parts.big"], 100);

    while (!parts.built() && done.length < 20) {
      parts.frame();
      done.push(parts.built());
      boxed.push(0);
    }

    off();
    boxed.pop();

    expect(boxed).toEqual([100, 100, 100]);
    expect(done).toEqual([false, false, true]);
  });

  // Bug: a host that rises in a part takes its views at once, under a root not applied yet.
  it("hosts the views of a host that rose in a part when the last part is applied", async () => {
    const parts = await start();
    const parented = (): number =>
      parts.app.world.projection
        .entitiesOf("parts.pieces")
        .filter(view => parts.app.world.ecs.get(view, Parent)?.entity === marked(parts, "host"))
        .length;

    parts.build(["parts.hosted", "parts.pieces"], 100);
    parts.frame();

    // The host is live after the first part; the root is not applied whole.
    expect(marked(parts, "host")).toBeDefined();
    expect(parts.built()).toBe(false);
    expect(parented()).toBe(0);

    parts.frame();

    expect(parts.built()).toBe(true);
    expect(parented()).toBe(3);
  });

  // Bug: a scroll of a root applied in parts is moved, ranged or placed before its root is whole,
  // or does not settle once it is.
  it("leaves the scrolls of a root out until its last part, then settles them as one block", async () => {
    const parts = await start();
    const counters = parts.app.world.ecs.resource(UiCounters);
    const renders = counters.windowRenders;
    const waited: Array<{ win: boolean; offset: number | undefined; renders: number }> = [];

    parts.build(["parts.scrolls"], 100);
    parts.frame();

    while (!parts.built() && waited.length < 20) {
      const list = marked(parts, "list");

      waited.push({
        win: marked(parts, "win") !== undefined,
        offset: list === undefined ? undefined : parts.app.world.ecs.get(list, Scroll)?.offset,
        renders: counters.windowRenders - renders
      });
      parts.frame();
    }

    // Both scrolls were live while the root waited: none was placed and no range moved.
    expect(waited.length).toBeGreaterThanOrEqual(1);
    expect(waited.every(frame => frame.win && frame.offset === 0 && frame.renders === 0)).toBe(
      true
    );
    // In the frame the last part landed, the list stands at its prop.
    expect(parts.app.world.ecs.get(marked(parts, "list") ?? 0, Scroll)?.offset).toBe(-120);

    commitAndSettle(parts);

    const block = await oneBlock(["parts.scrolls"]);
    const offsetOf = (fixture: Parts, name: string) =>
      fixture.app.world.ecs.get(marked(fixture, name) ?? 0, Scroll);

    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
    expect(offsetOf(parts, "list")).toEqual(offsetOf(block, "list"));
    expect(offsetOf(parts, "win")).toEqual(offsetOf(block, "win"));
  });

  // Bug: a windowed list of a root whose build waits moves its range: its rows are diffed while
  // parts of the root are parked, or the rows after the commit are not one block's.
  it("moves no range of a windowed list while parts of its root are parked", async () => {
    const parts = await start();
    const { made, clock } = recordMade(parts);
    const counters = parts.app.world.ecs.resource(UiCounters);
    const renders = counters.windowRenders;
    const waited: Array<{ tall: boolean; made: number; renders: number }> = [];

    // A budget of 0: the first application stops after 8 elements, the list live among them.
    parts.build(["parts.listed"], 0);
    clock.frame = 1;
    parts.frame();

    expect(marked(parts, "tall")).toBeDefined();
    expect(parts.app.flow.gate.answer({ intent: "more" })).toBe(true);
    await settle();

    while (!parts.built() && waited.length < 60) {
      clock.frame += 1;
      parts.frame();
      waited.push({
        tall: marked(parts, "tall") !== undefined,
        made: made.size,
        renders: counters.windowRenders - renders
      });
    }

    const parked = waited.filter((frame, index) => frame.made > (waited[index - 1]?.made ?? 0));

    // The section's rows came over several frames, their leaves parked; no range moved meanwhile.
    expect(parked.length).toBeGreaterThanOrEqual(3);
    expect(waited.every(frame => frame.tall && frame.renders === 0)).toBe(true);

    commitAndSettle(parts);

    const block = await oneBlock(["parts.listed"], async fixture => {
      fixture.app.flow.gate.answer({ intent: "more" });
      await settle();
      fixture.frame();
    });

    expect(rootOf(block, "listedRoot")?.children[1]?.children).toHaveLength(6);
    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
  });

  // Bug: an overlay applied in a later part lands at another level than in one block.
  it("lands an overlay of a root applied in parts as one block does", async () => {
    const parts = await start();

    parts.build(["parts.overlay"], 100);
    untilBuilt(parts);
    commitAndSettle(parts);

    const block = await oneBlock(["parts.overlay"]);

    expect(levelOf(parts)).toEqual({ level: 1, landed: true });
    expect(levelOf(parts)).toEqual(levelOf(block));
  });
});

describe("a scene built in parts that ends early", () => {
  // Bug: a discard leaves elements of the parked parts or of the open application behind, or a
  // later frame goes on with them.
  it.each([
    { what: "parts parked", stepMs: 1, budget: 3 },
    { what: "an application open", stepMs: 0, budget: 100 }
  ])("leaves the world as it was after a discard with $what", async ({ stepMs, budget }) => {
    const parts = await start(stepMs);
    const before = idsOf(parts);

    parts.build(["parts.big"], budget);
    parts.frame();
    parts.frame();

    expect(parts.built()).toBe(false);

    parts.app.world.projection.discard();

    for (let index = 0; index < 3; index += 1) parts.frame();

    expect(idsOf(parts)).toEqual(before);
    expect(parts.app.ui.tree().key).toBe("wardRoot");
  });

  // Bug: a root whose key leaves while parts of it wait keeps them, and a later frame makes them.
  it("drops a root whose key leaves in the middle of its build, parts and all", async () => {
    const parts = await start(1);
    const before = idsOf(parts);

    parts.build(["parts.big"], 3);
    parts.frame();
    parts.frame();

    expect(parts.built()).toBe(false);
    expect(parts.app.flow.gate.answer({ intent: "hide" })).toBe(true);
    await settle();

    for (let index = 0; index < 3; index += 1) parts.frame();

    expect(parts.built()).toBe(true);
    expect(idsOf(parts)).toEqual(before);
  });

  // Bug: a restore in the middle of the build leaves parts of the dropped tree to be diffed: their
  // elements come back under despawned parents, or stay behind, so the rebuilt scene is not one block.
  it("builds the root again from nothing after a restore in the middle of its build", async () => {
    const parts = await start(1);
    const { made, clock } = recordMade(parts);

    parts.build(["parts.big"], 3);
    clock.frame = 1;
    parts.frame();
    clock.frame = 2;
    parts.frame();

    const old = [...made.keys()];

    // Parts are parked when the restore lands.
    expect(old.length).toBeGreaterThan(0);
    expect(old.length).toBeLessThan(300);

    parts.converged();
    stepRecorded(parts, clock);
    commitAndSettle(parts);

    const block = await oneBlock(["parts.big"]);

    expect(old.filter(entity => parts.app.world.ecs.ownerOf(entity) !== undefined)).toEqual([]);
    expect(rounded(parts.app.ui.tree())).toEqual(rounded(block.app.ui.tree()));
    expect(strayed(parts, rootOf(parts, "bigRoot") ?? parts.app.ui.tree())).toEqual([]);
    expect(parts.app.world.ecs.count()).toBe(block.app.world.ecs.count());
  });
});
