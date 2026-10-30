/* eslint-disable unicorn/no-null -- the report says `null` for no reason and no take. */
import * as pixi from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Display, Parent, Shape, Sprite, Transform } from "../../components";
import { withDeps } from "../../lifecycle";
import { swapHidden } from "../../sync/hidden";
import type { WhyEntry } from "../../sync/types";
import type { Config, FilterSlot, FilterSlotInputs, PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// F126 stage 0: `sync.debug.why()`, one entry per filtered view: how it is drawn, why it is not kept, how many still
// frames are left before a take, what its last take was for. The whole renderer over the real Pixi of `stagePixi`, an
// agent build, every frame drawn unless a test says otherwise.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/** The clock of the test: `second` moves it. */
const clock = { now: 0 };

beforeEach(() => {
  clock.now = 0;
});

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Starts an agent build and keeps it for the teardown.
 *
 * @param config - The renderer's config.
 * @returns The running renderer.
 */
async function open(config: Partial<Config> = {}): Promise<Drawn> {
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);

  const drawn = await startDrawn({ onDemand: false, config });

  running.push(drawn);

  return drawn;
}

/**
 * A slot of a real Pixi filter the cache may keep.
 *
 * @param filter - The filter.
 * @param fields - Other fields of the slot.
 * @returns The slot.
 */
function slotOf(
  filter: pixi.Filter = new pixi.ColorMatrixFilter(),
  fields: Partial<FilterSlot> = {}
): FilterSlot {
  return { filter, passes: 1, cache: "local", ...fields };
}

/**
 * Spawns a 40 x 40 shape at a place, with a filter on it, and builds its view: its first drawn frame.
 *
 * @param drawn - The running renderer.
 * @param slot - Its filter slot.
 * @param x - Its x.
 * @returns The entity.
 */
function filtered(drawn: Drawn, slot: FilterSlot = slotOf(), x = 100): Entity {
  const entity = drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [slot]);
  drawn.frame();

  return entity;
}

/**
 * Takes the picture of a filtered view.
 *
 * @param drawn - The running renderer.
 * @param slot - Its filter slot.
 * @param x - Its x.
 * @returns The entity, kept.
 */
function kept(drawn: Drawn, slot: FilterSlot = slotOf(), x = 100): Entity {
  const entity = filtered(drawn, slot, x);

  drawn.frames(2);

  return entity;
}

/**
 * The monitor's label of an entity's view.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The label.
 */
function labelOf(drawn: Drawn, entity: Entity): string {
  return drawn.mock.ctx.state.sync.views.get(entity)?.object.label ?? "";
}

/**
 * The top of an entity's view.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The top.
 */
function topOf(drawn: Drawn, entity: Entity): PixiContainer {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return view.wrapper ?? view.object;
}

/**
 * The entry of an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Its entry.
 */
function entryOf(drawn: Drawn, entity: Entity): WhyEntry | undefined {
  const label = labelOf(drawn, entity);

  return drawn.mock.api.sync.debug.why().find(entry => entry.view === label);
}

/**
 * The root container of the renderer.
 *
 * @param drawn - The running renderer.
 * @returns The root.
 */
function rootOf(drawn: Drawn): PixiContainer {
  const { root } = drawn.mock.ctx.state.sync;

  if (root === undefined) throw new Error("no root");

  return root;
}

/**
 * Hides a view under a cover, as an overlay does.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 */
function cover(drawn: Drawn, entity: Entity): void {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  swapHidden(
    { ctx: withDeps(drawn.mock.ctx), deps: { demand: drawn.mock.modules.demand } },
    view,
    "cover",
    true
  );
}

/**
 * Runs the frames that close the measuring window open now.
 *
 * @param drawn - The running renderer.
 */
function second(drawn: Drawn): void {
  for (let frame = 0; frame < 2; frame += 1) {
    clock.now += 500;
    drawn.mock.setNow(clock.now);
    drawn.frame();
  }
}

/**
 * A lamp that moves every frame: its mark makes every kept record step (a calm frame steps none).
 *
 * @param drawn - The running renderer.
 * @returns One frame with the lamp a step further.
 */
function withLamp(drawn: Drawn): () => void {
  const lamp = drawn.spawn(Transform({ x: 900, y: 1500 }), Shape({ w: 8, h: 8 }));
  let x = 900;

  drawn.frame();

  return () => {
    x += 1;
    drawn.mock.world.ecs.set(lamp, Transform, { x });
    drawn.frame();
  };
}

/**
 * A kept panel with a child inside.
 *
 * @param drawn - The running renderer.
 * @returns The panel, kept, and its child.
 */
function keptPanel(drawn: Drawn): { panel: Entity; child: Entity } {
  const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));
  const child = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 4, y: 4 }),
    Shape({ w: 8, h: 8 }),
    Parent({ entity: panel })
  ]);

  drawn.mock.api.sync.filters.set(panel, [slotOf()]);
  drawn.frames(3);

  return { panel, child };
}

describe("why a view is drawn live: the checks of `eligible`", () => {
  // Bug: the switch off reads as a stale reason of the frames before it: a step that no longer runs writes nothing.
  it("off: the switch is off", async () => {
    const drawn = await open();
    const entity = kept(drawn);

    drawn.mock.api.sync.debug.kept(false);
    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "off", calmIn: 0 });
  });

  it("backdrop: a filter that reads what is under it", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();

    filter.blendRequired = true;

    expect(entryOf(drawn, filtered(drawn, slotOf(filter)))).toMatchObject({
      mode: "live",
      reason: "backdrop",
      calmIn: 0
    });
  });

  it("filter-blend: a filter that blends otherwise", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();

    filter.blendMode = "add";

    expect(entryOf(drawn, filtered(drawn, slotOf(filter)))?.reason).toBe("filter-blend");
  });

  it("faded-out: the top at alpha 0, or invisible", async () => {
    const drawn = await open();
    const entity = filtered(drawn);

    drawn.mock.world.ecs.set(entity, Shape, { alpha: 0 });
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("faded-out");

    drawn.mock.world.ecs.set(entity, Shape, { alpha: 1 });
    drawn.mock.api.invalidate(entity);
    topOf(drawn, entity).visible = false;
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("faded-out");
  });

  it("top-blend: the top blends otherwise", async () => {
    const drawn = await open();
    const entity = filtered(drawn);

    drawn.mock.api.invalidate(entity);
    topOf(drawn, entity).blendMode = "add";
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("top-blend");
  });

  it("hidden: a cover hides the top", async () => {
    const drawn = await open();
    const entity = filtered(drawn);

    cover(drawn, entity);
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("hidden");
  });

  it("ancestor-tint, ancestor-blend, ancestor-hidden: what an ancestor does to the view", async () => {
    const drawn = await open();
    const entity = filtered(drawn);
    const root = rootOf(drawn);

    root.tint = 0xff_00_00;
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("ancestor-tint");

    root.tint = 0xff_ff_ff;
    root.blendMode = "add";
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("ancestor-blend");

    root.blendMode = "normal";
    root.visible = false;
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("ancestor-hidden");

    root.visible = true;
    root.renderable = false;
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("ancestor-hidden");
  });

  it("placed-under-filter: a placed filter under a filtered ancestor", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
    const inner = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);

    drawn.mock.api.sync.filters.set(panel, [slotOf()]);
    drawn.mock.api.sync.filters.set(inner, [
      slotOf(new pixi.ColorMatrixFilter(), { cache: "placed", origin: new Float32Array(2) })
    ]);
    drawn.frames(4);

    expect(entryOf(drawn, inner)).toMatchObject({ mode: "live", reason: "placed-under-filter" });
    expect(entryOf(drawn, panel)?.mode).toBe("kept");
  });

  // Bug: the report walks the checks in another order than `eligible`, and a second failure hides the first.
  it("the first failing check wins when two fail", async () => {
    const drawn = await open();
    const entity = filtered(drawn);

    rootOf(drawn).tint = 0xff_00_00;
    cover(drawn, entity);
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("hidden");

    drawn.mock.world.ecs.set(entity, Shape, { alpha: 0 });
    drawn.frame();

    expect(entryOf(drawn, entity)?.reason).toBe("faded-out");
  });
});

describe("why a view is drawn live: the policy", () => {
  // Bug: the count of frames left is off by one, so a tool promises a take a frame late or early.
  it("waiting: still frames left before a take, which comes when it says", async () => {
    const drawn = await open();
    const entity = filtered(drawn);

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "waiting", calmIn: 2 });

    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ reason: "waiting", calmIn: 1 });

    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "kept", reason: null, calmIn: 0 });
  });

  // Bug: a record that never stepped has no reason at all, which reads as kept.
  it("waiting: a view whose record was never stepped", async () => {
    const drawn = await open();
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(entity, [slotOf()]);

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "waiting", calmIn: 2 });
  });

  it("waiting: the one first take of the frame went to another view (F114)", async () => {
    const drawn = await open();
    const first = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const other = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(first, [slotOf()]);
    drawn.mock.api.sync.filters.set(other, [slotOf()]);
    drawn.frames(3);

    expect(entryOf(drawn, first)?.mode).toBe("kept");
    expect(entryOf(drawn, other)).toMatchObject({ mode: "live", reason: "waiting", calmIn: 0 });
  });

  it("waiting: the ten takes of a crowd's frame went to others (F119)", async () => {
    const drawn = await open();
    const crowd = Array.from({ length: 12 }, (_view, index) =>
      drawn.spawn(Transform({ x: index * 60, y: 100 }), Shape({ w: 40, h: 40 }))
    );

    for (const entity of crowd) drawn.mock.api.sync.filters.set(entity, [slotOf()]);

    drawn.frames(3);

    const last = crowd.at(-1) as Entity;

    expect(entryOf(drawn, last)).toMatchObject({ mode: "live", reason: "waiting", calmIn: 0 });
    expect(entryOf(drawn, crowd[0] as Entity)?.mode).toBe("kept");
  });

  it("alpha-due: a stack of alphas goes first in this frame (F114)", async () => {
    const drawn = await open();
    const alpha = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 40, h: 40 }));
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(entity, [slotOf()]);
    drawn.frame();
    drawn.mock.api.sync.filters.set(alpha, [slotOf(new pixi.AlphaFilter())]);
    drawn.frame();
    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "alpha-due", calmIn: 0 });
    expect(entryOf(drawn, alpha)?.mode).toBe("direct");
  });

  // Bug: a churned view reads as a plain wait of two frames, or `calmIn` does not count down.
  it("churn: changed in three frames in a row, eight still frames left, then fewer", async () => {
    const drawn = await open();
    const { panel, child } = keptPanel(drawn);

    for (let frame = 1; frame <= 3; frame += 1) {
      drawn.mock.world.ecs.set(child, Transform, { x: 4 + frame });
      drawn.frame();
    }

    expect(entryOf(drawn, panel)).toMatchObject({ mode: "live", reason: "churn", calmIn: 8 });

    drawn.frames(3);

    expect(entryOf(drawn, panel)).toMatchObject({ reason: "churn", calmIn: 5 });
  });

  // Bug: a kept view that goes live reads as one more wait; a refusal that holds never says it is the budget.
  it("budget: the take was refused and the refusal holds", async () => {
    const drawn = await open({ keptMb: (1.5 * 2 * 40 * 40 * 4) / (1024 * 1024) });

    kept(drawn);

    const refused = kept(drawn, slotOf(), 200);

    expect(entryOf(drawn, refused)).toMatchObject({ mode: "live", reason: "budget", calmIn: 0 });

    drawn.frames(3);

    expect(entryOf(drawn, refused)).toMatchObject({ mode: "live", reason: "budget", calmIn: 0 });
  });

  // Bug: a retake refused drops a kept view to live with no reason at all, which the report reads as a plain wait.
  it("budget: a kept view whose retake is refused says so at once", async () => {
    const drawn = await open({ keptMb: (1.5 * 2 * 40 * 40 * 4) / (1024 * 1024) });
    const entity = kept(drawn);

    drawn.mock.world.ecs.set(entity, Shape, { w: 80 });
    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "budget", calmIn: 0 });
  });

  it("blend-below: a node under the top blends otherwise (F68)", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));

    drawn.mock.world.ecs.spawn(OWNER, [
      Parent({ entity: panel }),
      Transform({ x: 10, y: 10 }),
      Sprite({ texture: "fx.glow", width: 40, height: 40, blend: "add" })
    ]);
    drawn.mock.api.sync.filters.set(panel, [slotOf()]);
    drawn.frames(4);

    expect(entryOf(drawn, panel)).toMatchObject({ mode: "live", reason: "blend-below", calmIn: 0 });
  });

  it("display: a Display hangs under the top without onDemand", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));

    drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Display({ object: new pixi.Graphics().rect(0, 0, 20, 20).fill(0xff_00_00) }),
      Parent({ entity: panel })
    ]);
    drawn.mock.api.sync.filters.set(panel, [slotOf()]);
    drawn.frames(5);

    expect(entryOf(drawn, panel)).toMatchObject({ mode: "live", reason: "display", calmIn: 0 });
  });

  // Bug: every move offers the take again, so the report flips to `waiting` and promises a take that can never come.
  it("display: a moving view keeps saying so in every frame, until its subtree changes", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Display({ object: new pixi.Graphics().rect(0, 0, 20, 20).fill(0xff_00_00) }),
      Parent({ entity: panel })
    ]);

    drawn.mock.api.sync.filters.set(panel, [slotOf()]);
    drawn.frames(5);

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { x: 100 + frame });
      drawn.frame();

      expect(entryOf(drawn, panel)).toMatchObject({ reason: "display", calmIn: 0 });
    }

    // The Display left: the next attempt is free to take the view.
    drawn.mock.world.ecs.despawn(child);
    drawn.frames(4);

    expect(entryOf(drawn, panel)?.mode).toBe("kept");
  });

  // Bug: as above for a take that had nothing to render: `idle` and `waiting` in turn while the view moves off the canvas.
  it("idle: a moving view off the canvas keeps saying so in every frame, and is taken once it is on it", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(), 5000);

    drawn.frames(4);

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(entity, Transform, { x: 5000 + frame });
      drawn.frame();

      expect(entryOf(drawn, entity)).toMatchObject({ reason: "idle", calmIn: 0 });
    }

    drawn.mock.world.ecs.set(entity, Transform, { x: 100 });
    drawn.frames(3);

    expect(entryOf(drawn, entity)?.mode).toBe("kept");
  });

  it("idle: a take that had nothing to render stays idle until the view moves", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(), 5000);

    drawn.frames(4);

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "idle", calmIn: 0 });

    drawn.mock.world.ecs.set(entity, Transform, { x: 100 });
    drawn.frames(3);

    expect(entryOf(drawn, entity)?.mode).toBe("kept");
  });

  it("idle: a picture cut to the canvas while its linear part moves", async () => {
    const drawn = await open();
    const root = rootOf(drawn);
    const entity = drawn.spawn(Transform({ x: -1000, y: 0 }), Shape({ w: 3000, h: 400 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(entity, [slotOf()]);

    for (let frame = 0; frame < 8; frame += 1) {
      root.scale.set(frame % 2 === 0 ? 1.01 : 1.02);
      drawn.frame();
    }

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "idle", calmIn: 0 });
  });
});

describe("what a view without a record reports (R1)", () => {
  // Bug: a view the cache makes no record of drops out of the report: it is the very view a tool looks for.
  it("cache-false: a slot the cache may not keep", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter(), { cache: "screen" }));

    drawn.frames(3);

    expect(drawn.mock.ctx.state.kept.byEntity.has(entity)).toBe(false);
    expect(entryOf(drawn, entity)).toEqual({
      view: labelOf(drawn, entity),
      mode: "live",
      reason: "cache-false",
      calmIn: 0,
      retake: null
    });
  });

  it("backdrop: a screen slot that reads the backdrop", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();

    filter.blendRequired = true;

    const entity = filtered(drawn, slotOf(filter, { cache: "screen" }));

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "live", reason: "backdrop" });
  });
});

describe("the report", () => {
  it("kept: no reason, nothing left to wait for", async () => {
    const drawn = await open();
    const entity = kept(drawn);

    expect(entryOf(drawn, entity)).toEqual({
      view: labelOf(drawn, entity),
      mode: "kept",
      reason: null,
      calmIn: 0,
      retake: null
    });
  });

  it("direct: an Alpha-only stack its quad draws (F54)", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(new pixi.AlphaFilter()));

    drawn.frame();

    expect(entryOf(drawn, entity)).toMatchObject({ mode: "direct", reason: null, calmIn: 0 });
  });

  // Bug: the entries come in the order the filters were set, which says nothing about the draw order.
  it("lists the views in draw order, a child after its parent, whatever order their filters came in", async () => {
    const drawn = await open();
    const under = drawn.spawn(Transform({ x: 0, y: 100 }), Shape({ w: 40, h: 40 }));
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity: panel })
    ]);
    const over = drawn.spawn(Transform({ x: 400, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();

    for (const entity of [over, child, panel, under]) {
      drawn.mock.api.sync.filters.set(entity, [slotOf()]);
    }

    expect(drawn.mock.api.sync.debug.why().map(entry => entry.view)).toEqual(
      [under, panel, child, over].map(entity => labelOf(drawn, entity))
    );
  });

  // Bug: a view whose filters are all off is listed: it is drawn without a filter, nothing to explain.
  it("leaves out a view with no enabled filter and answers a fresh array", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();
    const entity = filtered(drawn, slotOf(filter));
    const before = drawn.mock.api.sync.debug.why();

    expect(entryOf(drawn, entity)).toBeDefined();
    expect(drawn.mock.api.sync.debug.why()).not.toBe(before);

    filter.enabled = false;

    expect(drawn.mock.api.sync.debug.why()).toEqual([]);
  });

  // Bug: a filter kept for an entity with no view yet reads a view that is not there; a view out of the stage (held by a
  // build) drops out of a report that promises every filtered view.
  it("leaves out an entity with no view yet, and lists a view out of the stage after those in it", async () => {
    const drawn = await open();
    const out = filtered(drawn);
    const shown = filtered(drawn, slotOf(), 300);
    const waiting = drawn.spawn(Transform({ x: 500, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(waiting, [slotOf()]);
    topOf(drawn, out).removeFromParent();

    expect(drawn.mock.api.sync.debug.why().map(entry => entry.view)).toEqual([
      labelOf(drawn, shown),
      labelOf(drawn, out)
    ]);
  });

  // Bug: the report ships in a build that has no use for it, or a caller could write into the shared answer.
  it("answers a frozen [] in a production and in a dev build, and while inert", async () => {
    const release = await startDrawn({ onDemand: false });

    running.push(release);
    filtered(release);

    const answer = release.mock.api.sync.debug.why();

    expect(answer).toEqual([]);
    expect(Object.isFrozen(answer)).toBe(true);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    expect(release.mock.api.sync.debug.why()).toEqual([]);

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    expect(createMockRenderer().api.sync.debug.why()).toEqual([]);
  });
});

describe("the last take of a view", () => {
  // Bug: `retake` stays for good, or shows a take of the second still open.
  it("first: the take of a view from live, reported for the full second it fell in, then gone", async () => {
    const drawn = await open();
    const entity = kept(drawn);

    expect(entryOf(drawn, entity)?.retake).toBeNull();

    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "first", by: null });

    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toBeNull();
  });

  // Bug: `by` names the view itself when a child's mark retook it: the tool cannot say which child churns.
  it("mark: names the child whose mark retook the picture", async () => {
    const drawn = await open();
    const { panel, child } = keptPanel(drawn);

    second(drawn);
    drawn.mock.world.ecs.set(child, Transform, { x: 9 });
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, panel)?.retake).toEqual({ why: "mark", by: labelOf(drawn, child) });
  });

  it("mark: names the view itself for its own change", async () => {
    const drawn = await open();
    const { panel } = keptPanel(drawn);

    second(drawn);
    drawn.mock.world.ecs.set(panel, Shape, { w: 210 });
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, panel)?.retake).toEqual({ why: "mark", by: labelOf(drawn, panel) });
  });

  // Bug: a retake from `dirtyAbove` names nobody: the marks collected say nothing of a refresh of the inner view.
  it("mark: names the inner record whose drawing changed", async () => {
    const drawn = await open();
    const { panel, child } = keptPanel(drawn);
    const slot = slotOf();

    drawn.mock.api.sync.filters.set(child, [slot]);
    drawn.frames(4);

    expect(entryOf(drawn, child)?.mode).toBe("kept");

    second(drawn);
    drawn.mock.api.sync.filters.set(child, [slot]);
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, panel)?.retake).toEqual({ why: "mark", by: labelOf(drawn, child) });
    expect(entryOf(drawn, child)?.retake).toEqual({ why: "filter", by: null });
  });

  it("inner-first: the first take of a view inside it (F114)", async () => {
    const drawn = await open();
    const { panel, child } = keptPanel(drawn);

    drawn.mock.api.sync.filters.set(child, [slotOf()]);
    drawn.frames(4);
    expect(entryOf(drawn, child)?.mode).toBe("kept");
    second(drawn);

    expect(entryOf(drawn, panel)?.retake).toEqual({
      why: "inner-first",
      by: labelOf(drawn, child)
    });
  });

  it("resolution: the stack's resolution moved, a stage-1 retake", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();

    filter.resolution = "inherit";

    const entity = kept(drawn, slotOf(filter));
    const step = withLamp(drawn);

    second(drawn);
    drawn.mock.api.monitor.setResolution(1.5);
    step();
    step();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "resolution", by: null });
  });

  it("resolution: the canvas's resolution moved, a refresh of the output alone", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const step = withLamp(drawn);

    second(drawn);
    drawn.mock.api.monitor.setResolution(1.5);
    step();
    step();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "resolution", by: null });
  });

  it("settle: the view came to rest off its picture's grid", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const step = withLamp(drawn);

    second(drawn);
    drawn.mock.world.ecs.set(entity, Transform, { x: 100.25 });
    step();
    step();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "settle", by: null });
  });

  it("scale-limit: a zoom past what a picture may be drawn scaled", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const step = withLamp(drawn);

    second(drawn);
    rootOf(drawn).scale.set(3);
    step();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "scale-limit", by: null });
  });

  it("placed-move: a placed view under a zoom, which is never drawn scaled", async () => {
    const drawn = await open();
    const entity = kept(
      drawn,
      slotOf(new pixi.ColorMatrixFilter(), { cache: "placed", origin: new Float32Array(2) })
    );
    const step = withLamp(drawn);

    second(drawn);
    rootOf(drawn).scale.set(1.2);
    step();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "placed-move", by: null });
  });

  it("canvas: a picture cut to the canvas moved and shows what it left out", async () => {
    const drawn = await open();
    const entity = drawn.spawn(Transform({ x: -1000, y: 0 }), Shape({ w: 3000, h: 400 }));

    drawn.mock.api.sync.filters.set(entity, [slotOf()]);
    drawn.frames(3);

    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.cut).toBe(true);

    second(drawn);
    drawn.mock.world.ecs.set(entity, Transform, { x: -990 });
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "canvas", by: null });
  });

  it("filter: stage 3 alone, a filter value", async () => {
    const drawn = await open();
    const slot = slotOf();
    const entity = kept(drawn, slot);

    second(drawn);
    drawn.mock.api.sync.filters.set(entity, [slot]);
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "filter", by: null });
  });

  it("chain: stages 2 and 3, a new version of the inputs", async () => {
    const drawn = await open();
    const version = { value: 1 };
    const inputs: FilterSlotInputs = {
      stages: [],
      count: 1,
      version: () => version.value,
      scaleOf: () => 0.5,
      draw: vi.fn(),
      hold: vi.fn()
    };
    const slot = slotOf(new pixi.ColorMatrixFilter(), { inputs });
    const entity = kept(drawn, slot);

    second(drawn);
    version.value = 2;
    drawn.mock.api.sync.filters.set(entity, [slot]);
    drawn.frame();
    second(drawn);

    expect(entryOf(drawn, entity)?.retake).toEqual({ why: "chain", by: null });
  });
});
