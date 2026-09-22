import { describe, expect, it } from "vitest";
import type { MotionHandle, TweenOptions } from "../../projection/types";
import { BOARD, commitItems, mountBoard, Transform } from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

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

describe("projection tween", () => {
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
