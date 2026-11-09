import { afterEach, describe, expect, it, vi } from "vitest";
import { component } from "../../ecs/define";
import type { ComponentType, Entity } from "../../ecs/types";
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

/** A label whose type gives `shown` to a plugin for good: the driver joins it with every mute. */
const Label = component("Label", { x: 0, y: 0, shown: 0 }, { owned: ["shown"] });

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
 * Builds a projection of labels over the timers.
 *
 * @param initialOnly - Whether `x` is given to another writer after the birth.
 * @returns The spec.
 */
function labels(initialOnly: boolean): AnyProjectionSpec {
  const base = {
    name: MARKS,
    layer: "items",
    from: (player: Player) => player.timers,
    key: (found: Timer) => found.id,
    view: (found: Timer) => [Label({ x: found.x })]
  };
  const spec = initialOnly
    ? projection({ ...base, initialOnly: [[Label, ["x"]]] })
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
  cause: "edge" | "rollback" | "restore" | "load" = "edge"
): void {
  setTimers(world, timers);
  world.commit(cause);
  world.frame(16);
}

/**
 * Mutes fields of every new ring from inside its spawn, the way `anim` mutes `Sprite.texture` in
 * its `onAdded(Frames)`: the listener runs before the projection knows the view.
 *
 * @param world - The mock world.
 * @param component - The component whose fields are muted.
 * @param fields - The fields.
 * @returns The removers, one for each ring born from now on.
 */
function muteInSpawn(
  world: MockWorld,
  component: ComponentType<object>,
  fields: readonly string[]
): Array<() => void> {
  const releases: Array<() => void> = [];

  world.api.ecs.onAdded(Arc, entity => {
    releases.push(world.api.projection.mute(entity, component, fields));
  });

  return releases;
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
    ["a load", (world: MockWorld): void => commitTimers(world, [timer("a")], "load")],
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

  // Bug: a key added again during its exit comes back with the writes of a birth, or its settle
  // brings the drawn field home with the others.
  it("is left by a revive: the key removed and added again during its exit", () => {
    const world = createMockWorld();

    mountMarks(
      world,
      [timer("a")],
      marks({ exit: view => view.tween(Arc, { alpha: 0 }, { ms: 200, ease: "linear" }) })
    );

    const ring = ringOf(world, "a");

    world.api.ecs.set(ring, Arc, { sweep: DRAWN });
    commitTimers(world, []);
    world.frame(100);

    expect(world.api.ecs.get(ring, Arc)?.alpha).toBeLessThan(1);

    commitTimers(world, [timer("a", { x: 5 })]);
    settleFrames(world);

    expect(ringOf(world, "a")).toBe(ring);
    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 1 });
    expect(world.api.ecs.get(ring, Transform)?.x).toBe(5);
    expect(corrected(world)).toBe(false);
  });
});

describe("projection initialOnly — a mute made inside the spawn", () => {
  // Bug: the birth puts the shared table over the one a listener's mute wrote inside the spawn,
  // so the projection writes the listener's field again (the flash of a `Frames` texture), and the
  // merge that fixes it writes into the table every view shares, or leaves the release nothing.
  it("keeps a mute of the same component next to the field, on that view only, until released", () => {
    const world = createMockWorld();
    const timers = [timer("a"), timer("b", { sweep: 0.5 })];
    const releases: Array<() => void> = [];

    // Only the ring born with a full arc is muted: "a".
    world.api.ecs.onAdded(Arc, (entity, arc) => {
      if (arc.sweep === 1) releases.push(world.api.projection.mute(entity, Arc, ["alpha"]));
    });
    mountMarks(world, timers, marks());

    for (const id of ["a", "b"])
      world.api.ecs.set(ringOf(world, id), Arc, { sweep: DRAWN, alpha: 0.3 });

    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 0.3 });
    expect(arcOf(world, "b")).toEqual({ sweep: DRAWN, alpha: 1 });

    for (const release of releases) release();
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN, alpha: 0.3 });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")).toEqual({ sweep: DRAWN, alpha: 1 });
  });

  // Bug: the merge keeps only the components the seed names, or only the ones the mute wrote.
  it("keeps a mute of another component next to the field, until released", () => {
    const world = createMockWorld();
    const timers = [timer("a")];
    const releases = muteInSpawn(world, Transform, ["x"]);

    mountMarks(world, timers, marks());
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    world.api.ecs.set(ringOf(world, "a"), Transform, { x: 7 });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);
    expect(world.api.ecs.get(ringOf(world, "a"), Transform)?.x).toBe(7);

    for (const release of releases) release();
    world.api.ecs.set(ringOf(world, "a"), Transform, { x: 7 });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);
    expect(world.api.ecs.get(ringOf(world, "a"), Transform)?.x).toBe(0);
  });

  // Bug: a mute made before the view was known asks for the fields to keep at that moment, finds
  // none, and its release drops the initialOnly field it also named.
  it("keeps the field when a mute made inside the spawn named it and is released", () => {
    const world = createMockWorld();
    const timers = [timer("a")];
    const releases = muteInSpawn(world, Arc, ["sweep"]);

    mountMarks(world, timers, marks());

    for (const release of releases) release();
    world.api.ecs.set(ringOf(world, "a"), Arc, { sweep: DRAWN });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);
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

  // Bug: a hot swap skips a view a `mute()` gave a table of its own, so it keeps the fields of
  // the old spec and never gets the new ones, or loses the mute.
  it("hands a view with a mute of its own the fields of a replaced spec, and keeps the mute", () => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, marks(undefined, false));

    const ring = ringOf(world, "a");
    const drawSweepAndX = (): void => {
      world.api.ecs.set(ring, Arc, { sweep: DRAWN });
      world.api.ecs.set(ring, Transform, { x: 7 });
    };

    world.api.projection.mute(ring, Transform, ["x"]);
    world.api.projection.replace(marks());
    world.frame(16);
    drawSweepAndX();
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(DRAWN);
    expect(world.api.ecs.get(ring, Transform)?.x).toBe(7);

    world.api.projection.replace(marks(undefined, false));
    world.frame(16);
    drawSweepAndX();
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(1);
    expect(world.api.ecs.get(ring, Transform)?.x).toBe(7);
  });

  // Bug: a hot swap to a spec without the option leaves its field muted for the whole life of a
  // view whose mute was released, and leaves the empty table behind.
  it("hands a view whose mute was released back to a replaced spec without the option", () => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, marks());

    const ring = ringOf(world, "a");

    world.api.projection.mute(ring, Transform, ["x"])();
    world.api.projection.replace(marks(undefined, false));
    world.frame(16);
    world.api.ecs.set(ring, Arc, { sweep: DRAWN });
    commitTimers(world, timers, "restore");

    expect(arcOf(world, "a")?.sweep).toBe(1);
    expect(world.ctx.state.projection.mutes.size).toBe(0);
  });

  // Bug: a hot swap adds a field to the set of a mute, but the driver keeps the set it joined with
  // the type's owned fields before, so the projection writes the new field.
  it("joins a field a replaced spec adds to a mute's set with the type's owned fields", () => {
    const world = createMockWorld();
    const timers = [timer("a")];

    mountMarks(world, timers, labels(false));

    const label = ringOf(world, "a");

    world.api.projection.mute(label, Label, ["y"]);
    // The restore asks for the muted fields of the label: the driver joins them now.
    commitTimers(world, timers, "restore");
    world.api.projection.replace(labels(true));
    world.frame(16);
    world.api.ecs.set(label, Label, { x: 7, y: 3 });
    commitTimers(world, timers, "restore");

    expect(world.api.ecs.get(label, Label)).toEqual({ x: 7, y: 3, shown: 0 });
  });
});

// ---------------------------------------------------------------------------
// F159: a pair with `when(item)` covers only the views whose item answered true at their birth.
// The answer is fixed for the life of the view; views with the same answers share one seed.
// ---------------------------------------------------------------------------

/** One part of a stopwatch: the hand turns with the clock, a bolt keeps what `view` gave it. */
type Part = { id: string; hand: boolean; sweep: number; x: number };
type Watch = { parts: Part[]; warmHand?: boolean };

const WATCH = "board.watch";

/**
 * Tells a hand: the `when` of most cases.
 *
 * @param found - The part.
 * @returns True for a hand.
 */
const isHand = (found: Part): boolean => found.hand;

/**
 * A `when` that throws for an item at x 5, else tells a hand.
 *
 * @param found - The part.
 * @returns True for a hand.
 * @throws {Error} For a part at x 5.
 */
function throwsAtFive(found: Part): boolean {
  if (found.x === 5) throw new Error("no hand");

  return found.hand;
}

/** What a case changes about the stopwatch projection. */
type WatchOptions = {
  when?: (found: Part) => boolean;
  /** Adds `[Transform, ["x"]]` without a `when` before the pair with one. */
  always?: boolean;
  motion?: ProjectionMotion<Part>;
};

/**
 * Builds the stopwatch projection: `Arc.sweep` is another writer's on the views `when` covers.
 *
 * @param options - What the case changes.
 * @returns The spec.
 */
function watch(options: WatchOptions = {}): AnyProjectionSpec {
  const when = options.when ?? isHand;
  const base = {
    name: WATCH,
    layer: "items",
    from: (player: Watch) => player.parts,
    key: (found: Part) => found.id,
    view: (found: Part) => [Arc({ sweep: found.sweep }), Transform({ x: found.x, y: 0, scale: 1 })],
    ...(options.motion === undefined ? {} : { motion: options.motion })
  };
  const spec =
    options.always === true
      ? projection({
          ...base,
          initialOnly: [
            [Transform, ["x"]],
            [Arc, ["sweep"], when]
          ]
        })
      : projection({ ...base, initialOnly: [[Arc, ["sweep"], when]] });

  return spec as AnyProjectionSpec;
}

/**
 * A part at rest: a bolt with a full arc at x 0.
 *
 * @param id - The key.
 * @param patch - Fields that differ.
 * @returns The item.
 */
function part(id: string, patch: Partial<Part> = {}): Part {
  return { id, hand: false, sweep: 1, x: 0, ...patch };
}

/**
 * Sets the player's parts.
 *
 * @param world - The mock world.
 * @param parts - The parts.
 */
function setParts(world: MockWorld, parts: Part[]): void {
  world.model.player = { parts } as unknown as Watch & Record<string, never>;
}

/**
 * Registers and mounts the stopwatch over the given parts, as a scene does.
 *
 * @param world - The mock world.
 * @param parts - The parts the player starts with.
 * @param spec - The projection.
 */
function mountWatch(world: MockWorld, parts: Part[], spec: AnyProjectionSpec): void {
  setParts(world, parts);
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(spec);
  world.start();
  world.api.projection.mount([WATCH], MOUNT_OWNER);
}

/**
 * Commits the parts and runs the frame that reconciles them.
 *
 * @param world - The mock world.
 * @param parts - The new parts.
 * @param cause - Why the commit happened.
 */
function commitParts(
  world: MockWorld,
  parts: Part[],
  cause: "edge" | "rollback" | "restore" | "load" = "edge"
): void {
  setParts(world, parts);
  world.commit(cause);
  world.frame(16);
}

/**
 * The entity of one part.
 *
 * @param world - The mock world.
 * @param id - The key.
 * @returns The entity.
 */
function partOf(world: MockWorld, id: string): Entity {
  return world.api.projection.entityOf(WATCH, id) ?? 0;
}

/**
 * The stored arc of one part.
 *
 * @param world - The mock world.
 * @param id - The key.
 * @returns The stored sweep.
 */
function sweepOf(world: MockWorld, id: string): number | undefined {
  return world.api.ecs.get(partOf(world, id), Arc)?.sweep;
}

/**
 * Draws the arc of each part, as the system of the hand does.
 *
 * @param world - The mock world.
 * @param ids - The keys.
 */
function draw(world: MockWorld, ids: readonly string[]): void {
  for (const id of ids) world.api.ecs.set(partOf(world, id), Arc, { sweep: DRAWN });
}

/**
 * The keys a `world:initial-only-changed` warning named, in order.
 *
 * @param world - The mock world.
 * @returns One key per warning.
 */
function drifted(world: MockWorld): string[] {
  const calls = (world.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  return calls
    .filter(([event]) => event === "world:initial-only-changed")
    .map(([, data]) => {
      const address = data as { projection: string; key: string };

      expect(address.projection).toBe(WATCH);

      return address.key;
    });
}

describe("projection initialOnly when — the birth", () => {
  // Bug: `when` is ignored and the pair covers every view, or covers none.
  it("mutes the field only on the views whose item answered true", () => {
    const world = createMockWorld();
    const parts = [part("hand", { hand: true }), part("bolt")];

    mountWatch(world, parts, watch());
    draw(world, ["hand", "bolt"]);
    commitParts(world, parts, "restore");

    expect(sweepOf(world, "hand")).toBe(DRAWN);
    expect(sweepOf(world, "bolt")).toBe(1);
    expect(world.ctx.state.projection.mutes.has(partOf(world, "bolt"))).toBe(false);
  });

  // Bug: a seed is built per birth, so a long list pays a table per view.
  it("gives the views with the same answers one frozen table, a play birth too", () => {
    const world = createMockWorld();
    const parts = [part("a", { hand: true }), part("b")];

    mountWatch(world, parts, watch());
    commitParts(world, [...parts, part("c", { hand: true })]);

    const mutes = world.ctx.state.projection.mutes;
    const shared = mutes.get(partOf(world, "a"));

    expect(shared).toBeDefined();
    expect(Object.isFrozen(shared)).toBe(true);
    expect(mutes.get(partOf(world, "c"))).toBe(shared);
  });

  // Bug: the seed of a mask holds only the pairs with a `when`, so a view that answers false
  // loses the pairs that cover every view.
  it("keeps the pairs without a when on a view whose item answered false", () => {
    const world = createMockWorld();
    const parts = [part("hand", { hand: true }), part("bolt")];

    mountWatch(world, parts, watch({ always: true }));
    draw(world, ["hand", "bolt"]);
    for (const id of ["hand", "bolt"]) world.api.ecs.set(partOf(world, id), Transform, { x: 7 });
    commitParts(world, parts, "restore");

    expect(sweepOf(world, "hand")).toBe(DRAWN);
    expect(sweepOf(world, "bolt")).toBe(1);
    expect(world.api.ecs.get(partOf(world, "hand"), Transform)?.x).toBe(7);
    expect(world.api.ecs.get(partOf(world, "bolt"), Transform)?.x).toBe(7);
  });

  // Bug: a throwing `when` is caught nowhere and breaks the frame, or the view is spawned before
  // it is asked and stays behind without a record.
  it("takes a when that throws as a failed birth: world:projection-failed, nothing spawned", () => {
    const world = createMockWorld();
    const births: Entity[] = [];
    const when = (found: Part): boolean => {
      if (found.id === "boom") throw new Error("no hand");

      return found.hand;
    };

    world.api.ecs.onAdded(Arc, entity => {
      births.push(entity);
    });
    mountWatch(world, [part("a", { hand: true })], watch({ when }));
    commitParts(world, [part("a", { hand: true }), part("boom")]);

    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: WATCH },
      expect.any(Error)
    );
    expect(births).toEqual([partOf(world, "a")]);
    expect(world.api.projection.entityOf(WATCH, "boom")).toBeUndefined();
  });
});

describe("projection initialOnly when — next to mute()", () => {
  // Bug: the release of a mute keeps the fields of the spec, not of the view, so it keeps the field
  // on a view `when` did not cover, or drops it on one it did.
  it("keeps the field on a mute's release only on a view the when covers", () => {
    const world = createMockWorld();
    const parts = [part("hand", { hand: true }), part("bolt")];

    mountWatch(world, parts, watch());
    for (const id of ["hand", "bolt"])
      world.api.projection.mute(partOf(world, id), Arc, ["sweep"])();
    draw(world, ["hand", "bolt"]);
    commitParts(world, parts, "restore");

    expect(sweepOf(world, "hand")).toBe(DRAWN);
    expect(sweepOf(world, "bolt")).toBe(1);
  });
});

describe("projection initialOnly when — a changed item", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug: a changed item asks `when` again, so a view gains or loses its seed mid-life.
  it("keeps the answer of the birth and asks no more in a release build", () => {
    const world = createMockWorld();
    const when = vi.fn(isHand);

    mountWatch(world, [part("a", { hand: true })], watch({ when }));
    // Same content but `hand` (the play path that only stores the item), then a real change.
    commitParts(world, [part("a")]);
    commitParts(world, [part("a", { x: 5 })]);
    settleFrames(world);
    draw(world, ["a"]);
    commitParts(world, [part("a", { x: 5 })], "restore");

    expect(when).toHaveBeenCalledTimes(1);
    expect(sweepOf(world, "a")).toBe(DRAWN);
    expect(drifted(world)).toEqual([]);
  });

  // Bug: the dev build never warns, warns on every change, or warns for an item whose answer holds.
  it("warns world:initial-only-changed once per view in a dev build, and changes nothing", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = createMockWorld();

    mountWatch(world, [part("a", { hand: true }), part("c", { hand: true })], watch());
    commitParts(world, [part("a", { hand: true, x: 2 }), part("c", { hand: true })]);

    expect(drifted(world)).toEqual([]);

    // `a` keeps its content (only stored), `c` changes it (written).
    commitParts(world, [part("a", { x: 2 }), part("c", { x: 4 })]);

    expect(drifted(world)).toEqual(["a", "c"]);

    commitParts(world, [part("a", { x: 9 }), part("c", { x: 5 })]);
    settleFrames(world);
    draw(world, ["a", "c"]);
    commitParts(world, [part("a", { x: 9 }), part("c", { x: 5 })], "restore");

    expect(drifted(world)).toEqual(["a", "c"]);
    expect(sweepOf(world, "a")).toBe(DRAWN);
    expect(sweepOf(world, "c")).toBe(DRAWN);
  });

  // Bug: the dev check lets a `when` that throws on the new item stop the reconcile, so a dev build
  // drops a change a release build writes.
  it("warns nothing and writes the change when a when throws on the new item in a dev build", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = createMockWorld();

    mountWatch(world, [part("a", { hand: true })], watch({ when: throwsAtFive }));
    commitParts(world, [part("a", { hand: true, x: 5 })]);
    settleFrames(world);

    expect(world.api.ecs.get(partOf(world, "a"), Transform)?.x).toBe(5);
    expect(drifted(world)).toEqual([]);
    expect(world.log.error).not.toHaveBeenCalled();
  });

  // Bug: a key that comes back during its exit takes the new item unseen by the drift check.
  it("warns for a view revived with an item that answers otherwise", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = createMockWorld();

    mountWatch(
      world,
      [part("a", { hand: true })],
      watch({
        motion: { exit: view => view.tween(Transform, { x: 50 }, { ms: 200, ease: "linear" }) }
      })
    );

    const entity = partOf(world, "a");

    commitParts(world, []);
    world.frame(100);
    commitParts(world, [part("a")]);

    expect(partOf(world, "a")).toBe(entity);
    expect(drifted(world)).toEqual(["a"]);
  });
});

/**
 * A stopwatch shown while the session is open, its window held warm on a hand (on a bolt once the
 * player sets `warmHand: false`).
 *
 * @param when - The `when` of its pair.
 * @returns The world, mounted closed and warmed up.
 */
function warmWatch(when: (found: Part) => boolean = isHand): MockWorld {
  const world = createMockWorld();
  const spec = projection({
    name: WATCH,
    layer: "items",
    from: (_player: Watch, session: { open?: boolean }): Part[] =>
      session.open === true ? [part("w", { x: 3 })] : [],
    key: (found: Part) => found.id,
    view: (found: Part) => [Arc({ sweep: found.sweep }), Transform({ x: found.x })],
    warm: (player: Watch) => part("w", { hand: player.warmHand !== false }),
    initialOnly: [[Arc, ["sweep"], when]]
  }) as AnyProjectionSpec;

  setParts(world, []);
  world.model.session = {};
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(spec);
  world.start();
  world.api.projection.onBuild(() => true);
  world.api.projection.mount([WATCH], MOUNT_OWNER);
  world.frame(16);
  world.frame(16);

  return world;
}

describe("projection initialOnly when — a warm window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug: the held view is asked on the item it is shown with, or never, so the answer of its birth
  // is lost; or the drift check misses a warm view shown with another item.
  it("asks when on the warm item, and a dev build warns when the shown item answers otherwise", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = warmWatch();
    const held = world.ctx.state.projection.warm.get(WATCH)?.view?.entity;

    world.model.session = { open: true };
    world.commit("edge", ["session"]);
    world.frame(16);

    // The open itself warns: the held view took the shown item in `adoptEntry`.
    expect(drifted(world)).toEqual(["w"]);

    draw(world, ["w"]);
    world.commit("restore", ["session"]);
    world.frame(16);

    expect(partOf(world, "w")).toBe(held);
    expect(sweepOf(world, "w")).toBe(DRAWN);
    expect(world.api.ecs.get(partOf(world, "w"), Transform)?.x).toBe(3);
    expect(drifted(world)).toEqual(["w"]);
  });

  // Bug: a held view whose warm item changes takes the new item in `writeDifference` unseen by the
  // drift check.
  it("warns in a dev build when the warm item of a held view changes its answer", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = warmWatch();
    const record = world.ctx.state.projection.warm.get(WATCH);
    const held = record?.view;

    world.model.player = { parts: [], warmHand: false };
    world.commit("edge", ["player"]);
    world.frame(16);
    world.frame(16);

    // The same held view took the new warm item: written into, not built again.
    expect(record?.view).toBe(held);
    expect(held?.item).toEqual(part("w"));
    expect(drifted(world)).toEqual(["w"]);
  });

  // Bug: a `when` that throws on the warm item escapes the warm step and breaks the frame, or a
  // view is held without the answer of its birth.
  it("takes a when that throws on the warm item as a failed build: logged, nothing held", () => {
    const world = warmWatch(() => {
      throw new Error("no hand");
    });

    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: WATCH },
      expect.any(Error)
    );
    expect(world.ctx.state.projection.warm.get(WATCH)?.view).toBeUndefined();
  });
});

describe("projection initialOnly when — replace", () => {
  // Bug: `replace` keeps the answers of the birth, or asks the old spec, so a hot swap of the
  // `when` never reaches the live views.
  it("asks the new spec's when on the item each view shows now", () => {
    const world = createMockWorld();

    mountWatch(world, [part("a", { hand: true }), part("b")], watch());
    // A release build keeps the answers of the birth: `a` muted, `b` not.
    commitParts(world, [part("a"), part("b", { hand: true })]);
    world.api.projection.replace(watch());
    world.frame(16);
    draw(world, ["a", "b"]);
    commitParts(world, [part("a"), part("b", { hand: true })], "restore");

    expect(sweepOf(world, "a")).toBe(1);
    expect(sweepOf(world, "b")).toBe(DRAWN);
  });

  // Bug: a view a `mute()` gave its own table keeps the old answer's seed sets, or loses its mute,
  // or never gets the seed of its new answer.
  it("moves a view with its own mute table to its new answer and keeps the mute", () => {
    const world = createMockWorld();

    mountWatch(world, [part("a", { hand: true }), part("b")], watch());
    for (const id of ["a", "b"]) world.api.projection.mute(partOf(world, id), Transform, ["x"]);
    // A release build keeps the answers of the birth; `replace` asks them again: `a` no, `b` yes.
    commitParts(world, [part("a"), part("b", { hand: true })]);
    world.api.projection.replace(watch());
    world.frame(16);
    draw(world, ["a", "b"]);
    for (const id of ["a", "b"]) world.api.ecs.set(partOf(world, id), Transform, { x: 7 });
    commitParts(world, [part("a"), part("b", { hand: true })], "restore");

    expect(sweepOf(world, "a")).toBe(1);
    expect(sweepOf(world, "b")).toBe(DRAWN);
    expect(world.api.ecs.get(partOf(world, "a"), Transform)?.x).toBe(7);
    expect(world.api.ecs.get(partOf(world, "b"), Transform)?.x).toBe(7);
  });

  // Bug: the views move while the masks are asked, so a `when` that throws halfway leaves some
  // views on the new spec's seed and the spec on the old one.
  it("throws for a when that throws, with every view's table and the spec as they were", () => {
    const world = createMockWorld();

    mountWatch(world, [part("a", { hand: true }), part("b")], watch());

    const state = world.ctx.state.projection;
    const spec = state.specs.get(WATCH);
    const table = state.mutes.get(partOf(world, "a"));
    const failing = watch({
      when: found => {
        if (found.id === "b") throw new Error("no hand");

        return true;
      }
    });

    expect(() => world.api.projection.replace(failing)).toThrow("no hand");
    expect(state.specs.get(WATCH)).toBe(spec);
    expect(state.mutes.get(partOf(world, "a"))).toBe(table);
    expect(state.mutes.has(partOf(world, "b"))).toBe(false);
  });
});

describe("projection initialOnly when — the spec", () => {
  // Bug: a third element that is no function is taken, and the birth throws a TypeError later.
  it("refuses a when that is no function, and a pair with a when and no field, at register", () => {
    const world = createMockWorld();
    const base = {
      name: WATCH,
      layer: "items",
      from: (player: Watch) => player.parts,
      key: (found: Part) => found.id,
      view: (found: Part) => [Arc({ sweep: found.sweep })]
    };
    const notFunction = {
      ...base,
      initialOnly: [[Arc, ["sweep"], true]]
    } as unknown as AnyProjectionSpec;
    const noField = projection({ ...base, initialOnly: [[Arc, [], isHand]] }) as AnyProjectionSpec;

    expect(() => world.api.projection.register(notFunction)).toThrow(
      '[game] Projection "board.watch" lists Arc in initialOnly with a "when" that is no function.\n' +
        "  Give a function of the item, or drop the third element."
    );
    expect(() => world.api.projection.register(noField)).toThrow(
      '[game] Projection "board.watch" lists Arc in initialOnly with no field.'
    );
    expect(world.ctx.state.projection.specs.has(WATCH)).toBe(false);
  });

  // Bug: a 33rd `when` takes bit 32, which is bit 0 again, so its answer mutes another pair's fields.
  it("refuses more pairs with a when than a mask holds", () => {
    const world = createMockWorld();
    const pairs = Array.from({ length: 33 }, () => [Arc, ["sweep"], isHand] as const);
    const spec = {
      name: WATCH,
      layer: "items",
      from: (player: Watch) => player.parts,
      key: (found: Part) => found.id,
      view: (found: Part) => [Arc({ sweep: found.sweep })],
      initialOnly: pairs
    } as unknown as AnyProjectionSpec;

    expect(() => world.api.projection.register(spec)).toThrow(
      '[game] Projection "board.watch" lists 33 initialOnly pairs with a "when".'
    );
  });
});

describe("projection initialOnly when — the ways home", () => {
  // Bug: a rest write reads the seed of the spec instead of the view's table, so it puts the
  // system's value back on a covered view or leaves an uncovered one off its rest.
  it.each([
    [
      "a rollback",
      (world: MockWorld, parts: Part[]): void => commitParts(world, parts, "rollback")
    ],
    ["a restore", (world: MockWorld, parts: Part[]): void => commitParts(world, parts, "restore")],
    ["a load", (world: MockWorld, parts: Part[]): void => commitParts(world, parts, "load")],
    [
      "settle(entity)",
      (world: MockWorld): void => {
        for (const id of ["hand", "bolt"]) world.api.projection.settle(partOf(world, id));
      }
    ]
  ])("keeps a covered view's field through %s and brings the others home", (_way, goHome) => {
    const world = createMockWorld();
    const parts = [part("hand", { hand: true }), part("bolt")];

    mountWatch(world, parts, watch());
    draw(world, ["hand", "bolt"]);
    // The same item objects: only the way home decides what is written.
    setParts(world, parts);
    goHome(world, parts);
    settleFrames(world);

    expect(sweepOf(world, "hand")).toBe(DRAWN);
    expect(sweepOf(world, "bolt")).toBe(1);
  });
});
