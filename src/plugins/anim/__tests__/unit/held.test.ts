import { describe, expect, it } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import type { Entity, TweenDriver } from "../../../world/types";
import { Frames } from "../../components";
import { createDriver } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: endless loops of views an overlay hides write nothing (spec 22 O9.3). The stand-in renderer of the mock
// answers `sync.loopsHeld` from `mock.held`; the clock of a held loop runs on, so it writes the phase of the time when
// it is shown again. Finite tracks always write.
// ---------------------------------------------------------------------------

/**
 * Nothing is muted.
 *
 * @returns An empty field set.
 */
function open(): ReadonlySet<string> {
  return new Set();
}

/**
 * A started mock world with one entity at x 0 and the real driver.
 *
 * @returns The mock, the driver and the entity.
 */
function setup(): { mock: MockAnim; driver: TweenDriver; entity: Entity } {
  const mock = createMockAnim();

  mock.start();

  const entity = spawnTestEntity(mock, [Transform({ x: 0 })]);

  return { mock, driver: createDriver(mock.actx), entity };
}

/**
 * Reads x of an entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity.
 * @returns Its x.
 */
function xOf(mock: MockAnim, entity: Entity): number | undefined {
  return mock.world.ecs.get(entity, Transform)?.x;
}

describe("anim — endless loops of held views", () => {
  it("an endless track of a held entity writes nothing and its value on release is the phase of the time that passed", () => {
    const { mock, driver, entity } = setup();

    driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );
    mock.frame(25);

    expect(xOf(mock, entity)).toBe(25);

    mock.held.add(entity);
    mock.frame(25);
    mock.frame(25);

    // Held: the loop wrote nothing while its clock ran on to 75 ms.
    expect(xOf(mock, entity)).toBe(25);

    mock.held.delete(entity);
    mock.frame(10);

    // Shown again: the phase of 85 ms, as if it had never been held.
    expect(xOf(mock, entity)).toBe(85);
  });

  it("a finite track of a held entity writes", () => {
    const { mock, driver, entity } = setup();

    mock.held.add(entity);
    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: 2 }, open);
    mock.frame(50);

    expect(xOf(mock, entity)).toBe(50);
  });

  it("an endless Frames loop of a held entity keeps its texture and shows the frame of the time when released", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: ["k0", "k1", "k2", "k3"], fps: 10 })
    ]);
    const texture = (): string | undefined => mock.world.ecs.get(entity, Sprite)?.texture;

    mock.frame(16);

    expect(texture()).toBe("k0");

    mock.held.add(entity);
    mock.frame(100);
    mock.frame(100);

    expect(texture()).toBe("k0");

    mock.held.delete(entity);
    mock.frame(16);

    // 232 ms of the loop: key 2.
    expect(texture()).toBe("k2");
  });

  it("a Frames animation that plays once writes while held", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: ["k0", "k1"], fps: 10, loop: false })
    ]);

    mock.held.add(entity);
    mock.frame(150);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("k1");
  });
});
