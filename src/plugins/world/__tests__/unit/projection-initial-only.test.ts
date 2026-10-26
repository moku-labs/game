import { describe, expect, it } from "vitest";
import { component } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, ProjectionMotion } from "../../projection/types";
import { LAYERS, MOUNT_OWNER, mountBoard, settleFrames, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: `initialOnly` (F91). The named fields of every view of the projection belong to
// another writer from the view's birth on: `view` gives them once, and no path of the projection
// writes or compares them after that. The "system" of these cases is a direct `ecs.set`.
// ---------------------------------------------------------------------------

/** The ring of a timer: `sweep` is drawn by a system, `alpha` belongs to the projection. */
const Arc = component("Arc", { sweep: 1, alpha: 1 });

type Timer = { id: string; sweep: number; alpha: number; x: number };
type Player = { timers: Timer[] };

const MARKS = "board.marks";

/** What the "system" draws into the arc of a ring. */
const DRAWN = 0.42;

/**
 * Builds the timer rings projection.
 *
 * @param motion - Motion hooks of this case, or none.
 * @param initialOnly - Whether `sweep` is given to another writer after the birth.
 * @returns The spec.
 */
function marks(motion?: ProjectionMotion<Timer>, initialOnly = true): AnyProjectionSpec {
  const base = {
    name: MARKS,
    layer: "items",
    from: (player: Player) => player.timers,
    key: (timer: Timer) => timer.id,
    view: (timer: Timer) => [
      Arc({ sweep: timer.sweep, alpha: timer.alpha }),
      Transform({ x: timer.x, y: 0, scale: 1 })
    ],
    ...(motion === undefined ? {} : { motion })
  };
  const spec = initialOnly
    ? projection({ ...base, initialOnly: [[Arc, ["sweep"]]] })
    : projection(base);

  return spec as AnyProjectionSpec;
}

/**
 * A timer ring at rest: full arc, opaque.
 *
 * @param id - The key.
 * @param patch - Fields that differ.
 * @returns The item.
 */
function timer(id: string, patch: Partial<Timer> = {}): Timer {
  return { id, sweep: 1, alpha: 1, x: 0, ...patch };
}

/**
 * Sets the player's timers.
 *
 * @param world - The mock world.
 * @param timers - The timers.
 */
function setTimers(world: MockWorld, timers: Timer[]): void {
  world.model.player = { timers } as unknown as Player & Record<string, never>;
}

/**
 * Registers and mounts a projection over the given timers, as a scene does.
 *
 * @param world - The mock world.
 * @param timers - The timers the player starts with.
 * @param spec - The projection.
 */
function mountMarks(world: MockWorld, timers: Timer[], spec: AnyProjectionSpec): void {
  setTimers(world, timers);
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(spec);
  world.start();
  world.api.projection.mount([MARKS], MOUNT_OWNER);
}

/**
 * The entity of one timer's ring.
 *
 * @param world - The mock world.
 * @param id - The key.
 * @returns The entity.
 */
function ringOf(world: MockWorld, id: string): Entity {
  return world.api.projection.entityOf(MARKS, id) ?? 0;
}

/**
 * The stored arc of one ring.
 *
 * @param world - The mock world.
 * @param id - The key.
 * @returns The stored value.
 */
function arcOf(
  world: MockWorld,
  id: string
): Readonly<{ sweep: number; alpha: number }> | undefined {
  return world.api.ecs.get(ringOf(world, id), Arc);
}

/**
 * Commits the timers and runs the frame that reconciles them.
 *
 * @param world - The mock world.
 * @param timers - The new timers.
 * @param cause - Why the commit happened.
 */
function commitTimers(
  world: MockWorld,
  timers: Timer[],
  cause: "edge" | "rollback" | "restore" = "edge"
): void {
  setTimers(world, timers);
  world.commit(cause);
  world.frame(16);
}

/**
 * Tells whether the convergence check corrected a view.
 *
 * @param world - The mock world.
 * @returns True after a `world:view-corrected` warning.
 */
function corrected(world: MockWorld): boolean {
  return (world.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
    ([event]) => event === "world:view-corrected"
  );
}

describe("projection initialOnly — the birth", () => {
  // Bug: the birth leaves the field out, so a new ring draws the component default, not its value.
  it("writes the field from view once per view, each view its own value", () => {
    const world = createMockWorld();

    mountMarks(world, [timer("a"), timer("b", { sweep: 0.5 })], marks());

    expect(arcOf(world, "a")).toEqual({ sweep: 1, alpha: 1 });
    expect(arcOf(world, "b")).toEqual({ sweep: 0.5, alpha: 1 });

    commitTimers(world, [timer("a"), timer("b", { sweep: 0.5 }), timer("c", { sweep: 0.25 })]);

    expect(arcOf(world, "c")).toEqual({ sweep: 0.25, alpha: 1 });
  });

  // Bug: every view of every projection gets a mute entry, the cost of the option paid without it.
  it("gives no view of a projection without the option a mute table", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    expect(world.ctx.state.projection.mutes.size).toBe(0);
  });
});

describe("projection initialOnly — after the birth", () => {
  // Bug: a motion hook's `set`, tween or `toRest` writes the field over what the system drew.
  it("is not written by the enter and change motions, and their end corrects nothing", () => {
    const world = createMockWorld();

    mountMarks(
      world,
      [],
      marks({
        enter: view => {
          view.set(Arc, { alpha: 0, sweep: 0 });

          return view.toRest(Arc, { ms: 200, ease: "linear" });
        },
        change: {
          Arc: view =>
            view.all([
              view.toRest(Arc, { ms: 200, ease: "linear" }),
              view.tween(Arc, { sweep: 0 }, { ms: 200, ease: "linear" })
            ])
        }
      })
    );

    commitTimers(world, [timer("a")]);

    // The hook's `sweep: 0` was not written; its `alpha: 0` was, and the fade has begun.
    expect(arcOf(world, "a")?.sweep).toBe(1);
    expect(arcOf(world, "a")?.alpha).toBeLessThan(0.5);

    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    world.frame(100);

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);
    expect(arcOf(world, "a")?.alpha).toBeGreaterThan(0.5);

    settleFrames(world);
    commitTimers(world, [timer("a", { alpha: 0.8 })]);
    settleFrames(world);

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 0.8 });
    expect(corrected(world)).toBe(false);
  });

  // Bug: the reconcile of a changed item writes the whole rest value, the drawn field included.
  it("is not written back by a changed item without a hook", () => {
    const world = createMockWorld();

    mountMarks(world, [timer("a")], marks());
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    commitTimers(world, [timer("a", { alpha: 0.6, x: 5 })]);
    settleFrames(world);

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 0.6 });
    expect(world.api.ecs.get(ringOf(world, "a"), Transform)?.x).toBe(5);
    expect(corrected(world)).toBe(false);
  });

  // Bug: a way home puts the projection's value back over the other writer's.
  it.each([
    ["a rollback", (world: MockWorld): void => commitTimers(world, [timer("a")], "rollback")],
    ["a restore", (world: MockWorld): void => commitTimers(world, [timer("a")], "restore")],
    ["settle(entity)", (world: MockWorld): void => world.api.projection.settle(ringOf(world, "a"))]
  ])("is left by %s, which brings the other fields home", (_way, goHome) => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, marks());
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN, alpha: 0.3 });
    // The same item objects: only the way home decides what is written.
    world.model.player = { timers } as unknown as Player & Record<string, never>;
    goHome(world);
    settleFrames(world);

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 1 });
  });
});

describe("projection initialOnly — next to mute()", () => {
  // Bug: mute() writes into the seed every view shares, so one mute mutes the field on all views.
  it("takes a mute on one view as more fields of that view only", () => {
    const world = createMockWorld();
    const timers = [timer("a"), timer("b")];

    mountMarks(world, timers, marks());
    world.api.projection.mute(ringOf(world, "a"), Arc, ["alpha"]);

    for (const id of ["a", "b"])
      world.api.ecs.set(ringOf(world, id), Arc, { sweep: DRAWN, alpha: 0.3 });

    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 0.3 });
    expect(arcOf(world, "b")).toEqual({ sweep: DRAWN, alpha: 1 });
  });

  // Bug: the release of a mute that named the field drops it, and the projection writes it again.
  it("keeps the field muted when a mute that named it is released", () => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, marks());

    const release = world.api.projection.mute(ringOf(world, "a"), Arc, ["sweep", "alpha"]);

    release();
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN, alpha: 0.3 });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 1 });
  });
});

describe("projection initialOnly — the spec", () => {
  // Bug: a pair with no field is taken, and the author's wish silently mutes nothing.
  it("refuses a pair with no field at register and replace, and keeps nothing", () => {
    const world = createMockWorld();
    const empty = projection({
      name: MARKS,
      layer: "items",
      from: (player: Player) => player.timers,
      key: (found: Timer) => found.id,
      view: (found: Timer) => [Arc({ sweep: found.sweep })],
      initialOnly: [[Arc, []]]
    }) as AnyProjectionSpec;
    const message =
      '[game] Projection "board.marks" lists Arc in initialOnly with no field.\n' +
      "  Name the fields only the birth of a view writes, or drop the pair.";

    expect(() => world.api.projection.register(empty)).toThrow(message);
    expect(() => world.api.projection.register(marks())).not.toThrow();
    expect(() => world.api.projection.replace(empty)).toThrow(message);
  });

  // Bug: a hot swap leaves the live views on the old spec, and the F91 correction comes back.
  it("hands the live views the fields of a replaced spec", () => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, marks(undefined, false));
    world.api.projection.replace(marks());
    world.frame(16);
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);

    world.api.projection.replace(marks(undefined, false));
    world.frame(16);
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(1);
  });
});
