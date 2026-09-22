import { describe, expect, it } from "vitest";
import type { AnyComponent } from "../../ecs/types";
import type { MotionHandle, TweenOptions } from "../../projection/types";
import { BOARD, commitItems, Level, mountBoard, Transform } from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the driver seam — the tween contract over the fake driver, and the
// instant default a world without an installed driver plays.
// ---------------------------------------------------------------------------

/**
 * Mounts the board and tweens `Transform.x` to 100 on the first change.
 *
 * @param world - The mock world.
 * @param options - Tween options of this test.
 * @returns A reader of the handle the hook created.
 */
function tweenOnChange(world: MockWorld, options: TweenOptions): () => MotionHandle | undefined {
  let handle: MotionHandle | undefined;

  mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
    change: {
      Transform: view => {
        handle = view.tween(Transform, { x: 100 }, options);

        return handle;
      }
    }
  });
  commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);

  return () => handle;
}

describe("projection tween over the driver", () => {
  it("reads the start value when the delay ends, not when the track is made", () => {
    const world = createMockWorld();

    tweenOnChange(world, { ms: 100, ease: "linear", delayMs: 32 });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(16);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);

    world.api.ecs.set(entity, Transform, { x: 20 });
    world.frame(16);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(20);

    world.frame(50);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(60);
  });

  it("writes the exact end value on the last frame", () => {
    const world = createMockWorld();
    const read = tweenOnChange(world, { ms: 100, ease: "linear" });
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(60);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(60);
    expect(read()?.active()).toBe(true);

    world.frame(60);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(100);
    expect(read()?.active()).toBe(false);
  });

  it("finishes to the target now and is idempotent", () => {
    const world = createMockWorld();
    const read = tweenOnChange(world, { ms: 1000, ease: "linear" });
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(16);
    read()?.finish();
    read()?.finish();

    expect(world.api.ecs.get(entity, Transform)?.x).toBe(100);
    expect(read()?.active()).toBe(false);
  });

  it("cancels without writing and is idempotent", () => {
    const world = createMockWorld();
    const read = tweenOnChange(world, { ms: 1000, ease: "linear" });
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(100);

    const halfway = world.api.ecs.get(entity, Transform)?.x ?? 0;

    read()?.cancel();
    read()?.cancel();

    expect(world.api.ecs.get(entity, Transform)?.x).toBe(halfway);
    expect(read()?.active()).toBe(false);
  });

  it("never writes a muted field, also not on finish", () => {
    const world = createMockWorld();
    let handle: MotionHandle | undefined;

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          handle = view.tween(Transform, { x: 100, y: 50 }, { ms: 100, ease: "linear" });

          return handle;
        }
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.mute(entity, Transform, ["x"]);
    commitItems(world, [{ id: "a", level: 1, x: 100, y: 50 }]);
    world.frame(50);

    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);
    expect(world.api.ecs.get(entity, Transform)?.y).toBe(25);

    handle?.finish();

    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);
    expect(world.api.ecs.get(entity, Transform)?.y).toBe(50);
  });

  it("advances every track of a frame, also the one after a track that ends", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view =>
          view.all([
            view.tween(Transform, { x: 100 }, { ms: 100, ease: "linear" }),
            view.tween(Transform, { y: 50 }, { ms: 100, ease: "linear" })
          ])
      }
    });
    commitItems(world, [{ id: "a", level: 1, x: 100, y: 50 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(16);
    expect(world.driver.active()).toBe(2);

    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 100, y: 50, scale: 1 });
    expect(world.driver.active()).toBe(0);
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("ends silently when the entity died", () => {
    const world = createMockWorld();
    const read = tweenOnChange(world, { ms: 1000, ease: "linear" });

    world.frame(16);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.despawn(entity);

    expect(() => world.frame(16)).not.toThrow();
    expect(read()?.active()).toBe(false);
  });

  it("eases in, out and inOut between the same two ends", () => {
    const world = createMockWorld();

    tweenOnChange(world, { ms: 100, ease: "inOut" });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(25);

    const quarter = world.api.ecs.get(entity, Transform)?.x ?? 0;

    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(25);

    world.frame(75);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(100);
  });
});

describe("projection driver slot", () => {
  it("hands the driver the entity, the component, the numeric target and the options", () => {
    const world = createMockWorld();

    tweenOnChange(world, { ms: 120, ease: "inBack", delayMs: 40, additive: true });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    // The commit reconciles at the start of the next frame, which is where the hook runs.
    world.frame(0);

    expect(world.driver.started).toEqual([
      {
        entity,
        component: "Transform",
        to: { x: 100 },
        options: { ms: 120, ease: "inBack", delayMs: 40, additive: true }
      }
    ]);
  });

  it("passes the delayMs of toRest on, so the motion starts after the delay", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => view.toRest(Transform, { ms: 100, ease: "linear", delayMs: 64 })
      }
    });
    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.frame(0);
    expect(world.driver.started[0]?.options.delayMs).toBe(64);

    world.frame(48);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);

    world.frame(16);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);

    world.frame(50);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(50);
  });

  it("cancels the tracks of an entity through the driver when its view despawns", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    // A track nobody handed to the view: only `cancelAll` reaches it.
    const foreign = world.driver.track(
      entity,
      Transform as unknown as AnyComponent,
      { y: 300 },
      { ms: 1000 },
      () => new Set<string>()
    );

    expect(foreign.active()).toBe(true);

    world.api.projection.unmount([BOARD]);

    expect(foreign.active()).toBe(false);
    expect(world.driver.active()).toBe(0);
  });

  it("writes the target at once and hands back an inactive handle without a driver", () => {
    const world = createMockWorld();
    const handles: MotionHandle[] = [];
    const seen: Array<number | undefined> = [];

    world.offDriver();
    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          handles.push(view.tween(Transform, { x: 60 }, { ms: 1000, ease: "linear" }));
          seen.push(view.get(Transform)?.x);

          return handles[0];
        }
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);

    // The track wrote its target inside the hook, and the settle after it brought the view home.
    expect(seen).toEqual([60]);
    expect(handles[0]?.active()).toBe(false);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(100);
    expect(() => handles[0]?.finish()).not.toThrow();
    expect(() => handles[0]?.cancel()).not.toThrow();
  });

  it("brings a view home at once through toRest without a driver", () => {
    const world = createMockWorld();

    world.offDriver();
    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 1000 }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 100, y: 0, scale: 1 });
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("never writes a muted field without a driver", () => {
    const world = createMockWorld();

    world.offDriver();
    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.tween(Transform, { x: 100, y: 50 }, { ms: 100 }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.mute(entity, Transform, ["x"]);
    commitItems(world, [{ id: "a", level: 1, x: 100, y: 50 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 50, scale: 1 });
  });

  it("takes the driver back with the remover, twice without harm, and installs a new one", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Level: view => view.tween(Level, { level: 9 }, { ms: 500, ease: "linear" }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.offDriver();
    world.offDriver();
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);

    // Instant again: the tween wrote 9 at once and the settle after it wrote the rest pose.
    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(world.driver.started).toEqual([]);

    world.api.projection.setDriver(world.driver);
    commitItems(world, [{ id: "a", level: 3, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.driver.started).toHaveLength(1);
  });
});
